// 런타임 데이터셋 정합성 감사.
//
// src/data.test.js 는 시드 템플릿(src/data.js)만 검사한다. 이 스크립트는 그 규칙을
// **지금 DB에 살아 있는 데이터**(stocks / financials / macro / hints)에 그대로 돌려서,
// 주가 생성기로 가격을 갈아치운 뒤 재무·시황·힌트가 얼마나 어긋났는지 수치로 뽑는다.
//
// 사용:
//   node scripts/audit-dataset.mjs [관리자비밀]
//   - 기본은 .env 의 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_ADMIN_PASSWORD
//   - 다른 DB 를 볼 때는 env 로 덮어쓴다(.env 안 건드림):
//       SUPABASE_URL=https://xxx.supabase.co SUPABASE_ANON_KEY=... ADMIN_SECRET=... node scripts/audit-dataset.mjs
//   - ERR 가 하나라도 있으면 exit 1

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { FIN_INPUTS, MACRO_METRICS, deriveFinancials } from '../src/metrics.js'

const NEWS_SENTINELS = ['전체 시장']
const NONNEG_FIN = ['currentAssets', 'noncurrentAssets', 'currentLiabilities', 'noncurrentLiabilities', 'operatingExpense', 'nonoperatingExpense']

// ── .env 로드 (dotenv 없이)
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)
const URL_ = process.env.SUPABASE_URL || env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
const SECRET = process.argv[2] || process.env.ADMIN_SECRET || env.VITE_ADMIN_PASSWORD || ''
if (!URL_ || !KEY) {
  console.error('.env 에 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 없습니다.')
  process.exit(2)
}

const sb = createClient(URL_, KEY)
const rpc = async (fn, args) => {
  const { data, error } = await sb.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return data
}
const sel = async (t, cols = '*') => {
  const { data, error } = await sb.from(t).select(cols)
  if (error) throw new Error(`select ${t}: ${error.message}`)
  return data
}

const problems = []
const ERR = (area, msg) => problems.push({ sev: 'ERR', area, msg })
const WARN = (area, msg) => problems.push({ sev: 'WARN', area, msg })

// ── 데이터 수집
const game = (await sel('game_state'))[0] ?? {}
const stocks = await sel('stocks')
const finRows = await rpc('admin_list_financials', { p_admin_secret: SECRET })
const macroRows = await rpc('admin_list_macro', { p_admin_secret: SECRET })
const hintsRes = await rpc('admin_list_hints', { p_admin_secret: SECRET })

if (hintsRes && hintsRes.ok === false) {
  console.error('관리자 비밀번호 불일치/미설정. `node scripts/audit-dataset.mjs <관리자비밀>` 로 전달하세요.')
  process.exit(2)
}
// admin_list_hints 는 { ok, hints:[...] } 를 돌려준다 (옛 버전은 bare 배열)
const hints = Array.isArray(hintsRes) ? hintsRes : (hintsRes?.hints ?? [])

// ── 라운드/연도 축 (game_state 에서)
const rym = game.round_year_map || {}
const ROUNDS = Object.entries(rym)
  .map(([r, y]) => ({ round: Number(r), year: Number(y) }))
  .sort((a, b) => a.round - b.round)
const FINAL_YEAR = game.final_year != null ? Number(game.final_year) : null
const FIN_YEARS = [...new Set([...ROUNDS.map((r) => r.year), ...(FINAL_YEAR != null ? [FINAL_YEAR] : [])])].sort((a, b) => a - b)
const yearOfRound = (r) => ROUNDS.find((x) => x.round === r)?.year
const nextYearOf = (round) => {
  const nr = ROUNDS.find((r) => r.round === round + 1)
  if (nr) return nr.year
  return ROUNDS.length && round === ROUNDS[ROUNDS.length - 1].round ? FINAL_YEAR : undefined
}

if (ROUNDS.length === 0) ERR('라운드', 'game_state.round_year_map 이 비어 있습니다.')
if (FINAL_YEAR == null) WARN('라운드', 'game_state.final_year 가 없습니다.')
for (let i = 1; i < ROUNDS.length; i++) {
  if (ROUNDS[i].round !== ROUNDS[i - 1].round + 1) ERR('라운드', `라운드 번호가 연속이 아님: ${ROUNDS[i - 1].round}→${ROUNDS[i].round}`)
  if (ROUNDS[i].year !== ROUNDS[i - 1].year + 1) WARN('라운드', `연도가 1씩 증가하지 않음: ${ROUNDS[i - 1].year}→${ROUNDS[i].year}`)
}
if (FINAL_YEAR != null && ROUNDS.length && FINAL_YEAR !== ROUNDS[ROUNDS.length - 1].year + 1)
  WARN('라운드', `final_year(${FINAL_YEAR}) 가 마지막 라운드 다음 해가 아님`)

// ── 종목
const ids = stocks.map((s) => s.id)
const byId = Object.fromEntries(stocks.map((s) => [s.id, s]))
const known = new Set([...ids, ...NEWS_SENTINELS])
const priceOf = (s, y) => {
  const v = s.prices?.[String(y)]
  return v == null ? null : Number(v)
}

if (new Set(ids).size !== ids.length) ERR('종목', '종목코드(id) 중복')
const names = stocks.map((s) => s.name)
if (new Set(names).size !== names.length) ERR('종목', `종목명 중복: ${names.filter((n, i) => names.indexOf(n) !== i).join(', ')}`)
for (const s of stocks) {
  if (!s.description) WARN('종목', `${s.name}: 한 줄 소개 없음`)
  for (const y of FIN_YEARS) {
    const p = priceOf(s, y)
    if (p == null) { WARN('종목', `${s.name} ${y}: 가격 항목 없음`); continue }
    if (!Number.isInteger(p)) ERR('종목', `${s.name} ${y}: 가격이 정수가 아님 (${p})`)
    if (p < 0) ERR('종목', `${s.name} ${y}: 가격이 음수 (${p})`)
  }
  const ly = yearOfRound(s.listed_from_round)
  if (ly != null) {
    const lp = priceOf(s, ly)
    if (!(lp > 0)) ERR('종목', `${s.name}: 상장 라운드(R${s.listed_from_round}, ${ly}년) 가격이 0 이하 (${lp})`)
  }
}

// ── 힌트
const validRounds = new Set(ROUNDS.map((r) => r.round))
if (hints.filter((h) => h.round === 1).length) ERR('힌트', 'R1 에 힌트가 있음 (R1은 지급 없음)')
for (const h of hints) {
  const tag = `${h.grade}R${h.round} "${(h.headline || '').slice(0, 20)}"`
  if (!['S', 'A', 'B', 'C', 'D'].includes(h.grade)) ERR('힌트', `${tag}: 등급이 S/A/B/C/D 아님 (${h.grade})`)
  if (!['up', 'down', 'flat'].includes(h.impact)) ERR('힌트', `${tag}: impact 가 up/down/flat 아님 (${h.impact})`)
  if (!validRounds.has(h.round)) ERR('힌트', `${tag}: 존재하지 않는 라운드`)
  for (const c of h.related_stock_ids || []) if (!known.has(c)) ERR('힌트', `${tag}: 관련 종목 '${c}' 없음`)
}
// 교육 계약: 호재/악재 태그가 다음 해 실제 등락 방향과 일치
let hintChecked = 0
for (const h of hints) {
  if (h.impact === 'flat') continue
  const y = yearOfRound(h.round)
  const ny = nextYearOf(h.round)
  if (y == null || ny == null) continue
  for (const code of h.related_stock_ids || []) {
    const s = byId[code]
    if (!s) continue
    const a = priceOf(s, y)
    const b = priceOf(s, ny)
    if (!a || b == null) continue // 미상장/거래정지
    hintChecked++
    const move = ((b - a) / a) * 100
    const ok = h.impact === 'up' ? move > 3 : move < -3
    if (!ok) ERR('힌트↔등락', `${h.grade}R${h.round} ${s.name}: '${h.impact}' 인데 ${y}→${ny} 실제 ${move.toFixed(1)}%`)
  }
}

// ── 재무제표
const db2key = Object.fromEntries(FIN_INPUTS.map((m) => [m.db, m.key]))
const finByStockYear = {}
for (const row of finRows || []) {
  ;(finByStockYear[row.stock_id] ??= {})[Number(row.year)] = row
}
for (const s of stocks) {
  const perYear = finByStockYear[s.id]
  if (!perYear || Object.keys(perYear).length === 0) { WARN('재무', `${s.name}: 재무 자료가 하나도 없음`); continue }
  for (const y of FIN_YEARS) {
    const row = perYear[y]
    const price = priceOf(s, y)
    if (!row) {
      if (price > 0) WARN('재무', `${s.name} ${y}: 가격은 있는데 재무 행이 없음`)
      continue
    }
    const camel = {}
    for (const m of FIN_INPUTS) {
      const v = row[m.db]
      camel[m.key] = v == null ? null : Number(v)
      if (v == null || !Number.isFinite(Number(v))) ERR('재무', `${s.name} ${y}: 입력값 '${m.label}'(${m.db}) 가 숫자가 아님 (${v})`)
    }
    for (const k of NONNEG_FIN) {
      if (camel[k] != null && camel[k] < 0) ERR('재무', `${s.name} ${y}: '${k}' 가 음수 (${camel[k]})`)
    }
    const d = deriveFinancials(camel)
    if (d?.impaired) WARN('재무', `${s.name} ${y}: 자본잠식 (자본 ${d.equity}) — 의도된 것인지 확인`)
  }
}

// ── 시황 (거시경제)
const macroByYear = Object.fromEntries((macroRows || []).map((m) => [Number(m.year), m]))
for (const y of FIN_YEARS) {
  const m = macroByYear[y]
  if (!m) { ERR('시황', `${y}년 시황 자료 없음`); continue }
  for (const metric of MACRO_METRICS) {
    const v = m[metric.db]
    if (v == null || !Number.isFinite(Number(v))) { ERR('시황', `${y}년 '${metric.label}'(${metric.db}) 가 숫자가 아님 (${v})`); continue }
    const n = Number(v)
    if (metric.db === 'rate') {
      if (n < 0) ERR('시황', `${y}년 기준금리가 음수 (${n})`)
    } else if (['kospi', 'sp500', 'nikkei', 'europe', 'oil', 'gold'].includes(metric.db)) {
      if (!(n > 0)) ERR('시황', `${y}년 '${metric.label}' 가 0 이하 (${n})`)
    }
  }
}

// ── 리포트
const errs = problems.filter((p) => p.sev === 'ERR')
const warns = problems.filter((p) => p.sev === 'WARN')
const group = (list) => {
  const by = {}
  for (const p of list) (by[p.area] ??= []).push(p.msg)
  return by
}
console.log('─'.repeat(64))
console.log(`DB        : ${URL_}`)
console.log(`데이터셋  : active_dataset_id=${game.active_dataset_id ?? '?'}  round=${game.current_round ?? '?'}`)
console.log(`연도 축   : 라운드 ${ROUNDS.map((r) => `R${r.round}=${r.year}`).join(' ')}  FINAL=${FINAL_YEAR}`)
console.log(`검사 대상 : 종목 ${stocks.length} · 힌트 ${hints.length} · 재무행 ${(finRows || []).length} · 시황 ${(macroRows || []).length}`)
console.log(`힌트↔등락 대조: ${hintChecked}건`)
console.log('─'.repeat(64))
for (const [sev, list] of [['오류', errs], ['경고', warns]]) {
  if (!list.length) continue
  console.log(`\n■ ${sev} (${list.length})`)
  const by = group(list)
  for (const area of Object.keys(by)) {
    console.log(`  [${area}]`)
    for (const msg of by[area]) console.log(`    - ${msg}`)
  }
}
console.log('\n' + '─'.repeat(64))
console.log(errs.length ? `❌ 오류 ${errs.length} · 경고 ${warns.length}` : warns.length ? `⚠ 오류 없음 · 경고 ${warns.length}` : '✅ 정합성 이상 없음')
process.exit(errs.length ? 1 : 0)
