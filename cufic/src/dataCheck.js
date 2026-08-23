// 콘텐츠 정합성 검사 — DB 편집엔 파일 테스트(data.test)가 안 걸리므로, 관리자 화면에서 저장 전/후
// 같은 규칙을 검사한다. 특히 ⭐힌트 impact가 관련 종목의 다음 해 실제 등락과 어긋나면 안 된다
// (정직하게 판단한 학생이 손해를 보는 치명적 버그).
//
// 반환: [{ level:'error'|'warn'|'info', msg }]

const dirOf = (p0, p1) => (p1 > p0 ? 'up' : p1 < p0 ? 'down' : 'flat')

/** 힌트 하나의 impact가 관련 종목 등락과 맞는지. 어긋난 종목 배열을 돌려준다(빈 배열=정상). */
export function hintMismatches(hint, stocks, game) {
  const rym = game?.round_year_map ?? {}
  const year = Number(rym[String(hint.round)])
  const nextYear = Number(rym[String(hint.round + 1)] ?? game?.final_year)
  if (!year || !nextYear || hint.impact === 'flat') return []
  const byId = Object.fromEntries(stocks.map((s) => [s.id ?? s.code, s]))
  const bad = []
  for (const id of hint.related_stock_ids ?? []) {
    const s = byId[id]
    if (!s) continue
    const p0 = Number(s.prices?.[String(year)] ?? 0)
    const p1 = Number(s.prices?.[String(nextYear)] ?? 0)
    if (!p0 || !p1) continue // 거래정지 구간은 판단 보류
    if (dirOf(p0, p1) !== hint.impact) bad.push({ name: s.name, dir: dirOf(p0, p1), year, nextYear })
  }
  return bad
}

/** 전체 콘텐츠 점검. game·stocks·hints (+ financials·macro 행)로 문제 목록을 만든다. */
export function checkContent(game, stocks, hints, financials = [], macro = []) {
  const issues = []
  if (!game) return issues
  const rym = game.round_year_map ?? {}
  const total = game.total_rounds ?? 0
  const roundYears = Object.entries(rym).map(([r, y]) => ({ round: Number(r), year: Number(y) }))
  const byId = Object.fromEntries(stocks.map((s) => [s.id ?? s.code, s]))

  // 1) ⭐ 힌트 impact ↔ 실제 등락
  for (const h of hints) {
    for (const id of h.related_stock_ids ?? []) {
      if (!byId[id]) {
        issues.push({ level: 'error', msg: `R${h.round} ${h.grade} 힌트의 관련 종목 '${id}'가 존재하지 않아요` })
      }
    }
    for (const m of hintMismatches(h, stocks, game)) {
      issues.push({
        level: 'error',
        msg: `R${h.round} ${h.grade} "${(h.headline ?? '').slice(0, 18)}…": ${m.name} 태그는 ${h.impact}인데 ${m.year}→${m.nextYear} 실제로 ${m.dir}`,
      })
    }
  }

  // 2) 라운드별 힌트 풀 (R2부터 자동 배분 대상). 라운드에 힌트가 하나도 없으면 경고.
  for (let r = 2; r <= total; r++) {
    const pool = hints.filter((h) => h.round === r)
    if (pool.length === 0) issues.push({ level: 'warn', msg: `R${r} 힌트가 하나도 없어요 (자동 배분 불가)` })
    else {
      const grades = new Set(pool.map((h) => h.grade))
      const missing = ['S', 'A', 'B', 'C', 'D'].filter((g) => !grades.has(g))
      if (missing.length) issues.push({ level: 'info', msg: `R${r} 힌트에 ${missing.join('·')} 등급이 없어요 (인접 등급으로 대체됨)` })
    }
  }

  // 3) 가격 공백: 상장된 종목이 라운드 연도에 가격이 없거나 0 (거래정지일 수도 있음 → info)
  for (const s of stocks) {
    const lf = s.listed_from_round ?? s.listedFromRound ?? 1
    for (const { round, year } of roundYears) {
      if (round < lf) continue
      const p = Number(s.prices?.[String(year)] ?? 0)
      if (!p) issues.push({ level: 'info', msg: `${s.name}: R${round}(${year}년) 가격이 비어 거래정지로 처리돼요` })
    }
  }

  // 4) 재무·시황 연도 커버리지 (info)
  const finYears = new Set(financials.map((f) => Number(f.year)))
  const macYears = new Set(macro.map((m) => Number(m.year)))
  const allYears = [...roundYears.map((r) => r.year), game.final_year].filter(Boolean)
  for (const y of allYears) {
    if (!macYears.has(Number(y))) issues.push({ level: 'info', msg: `${y}년 시황 지표가 없어요` })
  }
  void finYears

  return issues
}
