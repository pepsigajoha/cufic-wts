// 주가 생성기 — 새 가격 경로에 맞춰 재무제표·힌트를 결정적으로 다시 만든다.
//
// 숫자·방향은 전부 여기서(deriveNextFinancials / deriveRoundHints). 문장(헤드라인)만
// 나중에 LLM이 교체. 미리보기에 그대로 얹고, 관리자가 확인 후 admin_apply_generated_content
// 로 반영한다. self-check(hint↔등락 방향)를 같이 돌려 어긋나면 UI가 적용을 막는다.

import { FIN_INPUTS, deriveNextFinancials } from '../metrics'
import { deriveRoundHints } from '../distribute'

const CAMEL2DB = Object.fromEntries(FIN_INPUTS.map((m) => [m.key, m.db]))
const DB2CAMEL = Object.fromEntries(FIN_INPUTS.map((m) => [m.db, m.key]))

/** financials 행(snake) → { [stockId]: { [year]: {camel 7개} } } */
function indexFinancials(rows = []) {
  const out = {}
  for (const r of rows) {
    const camel = {}
    for (const m of FIN_INPUTS) camel[m.key] = Number(r[m.db]) || 0
    ;(out[r.stock_id] ??= {})[Number(r.year)] = camel
  }
  return out
}

const priceAt = (prices, id, year) => {
  const v = prices?.[id]?.[String(year)]
  return v == null ? null : Number(v)
}

/**
 * @param {object} p
 * @param {Record<string, Record<string, number>>} p.prices  { [stockId]: { [year]: price } } — 미리보기 가격
 * @param {Array<{id:string, name?:string}>} p.stocks
 * @param {Array<object>} p.financials  DB financials 행(snake). 앵커 연도 값의 출처.
 * @param {Record<number,{rate?:number,cpi?:number}>} p.macroByYear  연도 → 시황(%). 재생성 연도는 슬라이더 값.
 * @param {Record<string,number>} p.roundYearMap  game_state.round_year_map
 * @param {number|null} p.finalYear
 * @param {number[]} p.regenYears  재무를 다시 만들 연도(그 앞 연도가 앵커). 오름차순.
 * @returns {{financials:Array<object>, hints:Array<object>, replaceRounds:number[], check:{checked:number, mismatches:string[]}}}
 */
export function buildDerivedContent({
  prices,
  stocks = [],
  financials = [],
  macroByYear = {},
  roundYearMap = {},
  finalYear = null,
  regenYears = [],
}) {
  const finIdx = indexFinancials(financials)
  const nameOf = Object.fromEntries(stocks.map((s) => [s.id, s.name ?? s.id]))
  const allYears = [...new Set(Object.values(roundYearMap).map(Number))].sort((a, b) => a - b)
  const prevYearOf = (y) => {
    const below = allYears.filter((x) => x < y)
    return below.length ? below[below.length - 1] : null
  }

  // ── 재무제표: 재생성 연도를 오름차순으로 체인(앞 연도 결과를 다음 계산의 입력으로)
  const derivedFin = {} // { [stockId]: { [year]: {camel 7} } }
  const finRows = []
  for (const year of [...regenYears].sort((a, b) => a - b)) {
    const prevY = prevYearOf(year)
    if (prevY == null) continue
    for (const s of stocks) {
      const prev = derivedFin[s.id]?.[prevY] ?? finIdx[s.id]?.[prevY]
      if (!prev) continue // 앵커 재무가 없으면 건너뜀(미상장 등)
      const a = priceAt(prices, s.id, prevY)
      const b = priceAt(prices, s.id, year)
      if (!a || b == null) continue // 미상장·거래정지 구간
      const next = deriveNextFinancials(prev, {
        priceReturn: (b - a) / a,
        macroPrev: macroByYear[prevY] ?? macroByYear[year] ?? null,
        macroNext: macroByYear[year] ?? null,
      })
      if (!next) continue
      ;(derivedFin[s.id] ??= {})[year] = next
      const row = { stock_id: s.id, year }
      for (const k of Object.keys(next)) row[CAMEL2DB[k]] = next[k]
      finRows.push(row)
    }
  }

  // ── 힌트: 가격이 둘 다 있는 라운드(R2+)를 전부 다시 만든다
  const rounds = Object.entries(roundYearMap)
    .map(([r, y]) => ({ round: Number(r), year: Number(y) }))
    .sort((a, b) => a.round - b.round)
  const lastRound = rounds.length ? rounds[rounds.length - 1].round : 0
  const nextYearOf = (round) => {
    const nr = rounds.find((r) => r.round === round + 1)
    if (nr) return nr.year
    return round === lastRound ? finalYear : null
  }

  const hints = []
  const replaceRounds = []
  for (const { round, year } of rounds) {
    if (round <= 1) continue
    const ny = nextYearOf(round)
    if (ny == null) continue
    const returns = []
    for (const s of stocks) {
      const a = priceAt(prices, s.id, year)
      const b = priceAt(prices, s.id, ny)
      if (!a || b == null) continue
      returns.push({ stockId: s.id, name: nameOf[s.id], return: ((b - a) / a) * 100 })
    }
    if (returns.length === 0) continue
    const roundHints = deriveRoundHints({ round, returns })
    if (roundHints.length === 0) continue
    hints.push(...roundHints)
    replaceRounds.push(round)
  }

  // ── self-check: 힌트 호재/악재가 다음 해 실제 등락(±3%)과 맞는지 (data.test 규칙)
  const mismatches = []
  let checked = 0
  for (const h of hints) {
    const rd = rounds.find((r) => r.round === h.round)
    const ny = nextYearOf(h.round)
    if (!rd || ny == null) continue
    for (const id of h.related_stock_ids) {
      const a = priceAt(prices, id, rd.year)
      const b = priceAt(prices, id, ny)
      if (!a || b == null) continue
      checked++
      const move = ((b - a) / a) * 100
      const ok = h.impact === 'up' ? move > 3 : h.impact === 'down' ? move < -3 : true
      if (!ok) mismatches.push(`${h.grade}R${h.round} ${nameOf[id] ?? id}: ${h.impact} 인데 ${move.toFixed(1)}%`)
    }
  }

  return { financials: finRows, hints, replaceRounds, check: { checked, mismatches } }
}

export { DB2CAMEL }
