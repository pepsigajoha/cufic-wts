// 힌트 자동 배분 (R2부터). 규칙:
//   1. 라운드 힌트 풀을 등급 좋은 순(S→D), 같은 등급은 작성순(id 오름차순)으로 정렬.
//   2. 순위 꼴찌부터 1위 방향으로 한 장씩 라운드로빈 배정, 힌트가 소진될 때까지 반복.
//   → 모든 힌트 지급, 하위권일수록 좋은 힌트 + 더 많은 개수.
// distribute_round_hints(SQL)·[자동 배분 미리보기]·시뮬레이션 테스트가 모두 이 규칙을 따른다.

const GRADE_ORDER = { S: 0, A: 1, B: 2, C: 3, D: 4 }

/** 힌트 풀을 등급 좋은 순 → 작성순(id)으로 정렬 (가장 좋은 힌트가 앞). */
export function sortPool(hints) {
  return [...hints].sort(
    (a, b) => GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade] || Number(a.id) - Number(b.id),
  )
}

/**
 * 팀을 순위 꼴찌 먼저로 정렬. 평가금액 오름차순(꼴찌=낮은 평가금액), 동률은 생성순 → 코드.
 * 결정론적이어야 한다(서버와 같은 순서).
 */
export function rankWorstFirst(teams) {
  return [...teams].sort(
    (a, b) =>
      Number(a.equity) - Number(b.equity) ||
      (a.created_at ?? '').localeCompare?.(b.created_at ?? '') ||
      String(a.code ?? a.id).localeCompare(String(b.code ?? b.id)),
  )
}

/**
 * 라운드로빈 배정.
 * @param teamsWorstFirst 꼴찌→1위 순 팀 배열 (각 {code|id})
 * @param pool 정렬된 힌트 배열 (가장 좋은 것 먼저)
 * @returns Map(teamKey → 힌트배열)
 */
export function assignRoundRobin(teamsWorstFirst, pool) {
  const n = teamsWorstFirst.length
  const key = (t) => t.code ?? t.id
  const out = new Map(teamsWorstFirst.map((t) => [key(t), []]))
  if (n === 0) return out
  pool.forEach((h, i) => out.get(key(teamsWorstFirst[i % n])).push(h))
  return out
}

/** 편의: 팀 목록 + 힌트 풀 → Map(teamKey → 힌트배열). */
export function distribute(teams, hints) {
  return assignRoundRobin(rankWorstFirst(teams), sortPool(hints))
}

// ── 주가 생성기용: 라운드 힌트 풀을 엔진 수익률에서 만든다.
//
// [왜] 엔진이 새 가격 경로를 만들면 시드 힌트의 호재/악재가 실제 등락과 어긋난다
// (A1 감사에서 25건 중 9건이 방향 반대로 나옴). impact·grade·related 는 전부 여기서
// 수익률로 결정하고, 헤드라인 문장만 나중에 LLM이 그럴듯하게 교체한다.
//
// 규칙: 그 라운드에 |등락률|이 큰 종목 순으로 grades[0], grades[1] … 를 준다
// (가장 크게 움직이는 종목 = S). 방향은 등락률 부호. minMove 미만은 힌트로 안 낸다
// (data.test 의 ±3% 정합성 임계값과 같게).
const DEFAULT_HINT_GRADES = ['S', 'A', 'B', 'C', 'D']

function hintHeadline(name, impact) {
  if (impact === 'up') return `${name}, 실적·수급에 긍정 신호가 감지된다는 분석`
  if (impact === 'down') return `${name}, 부담 요인이 쌓이고 있다는 경계론`
  return `${name}, 방향을 가늠하기 어려운 국면`
}

/**
 * @param {object} p
 * @param {number} p.round   힌트가 붙는 라운드. R1(≤1)은 지급 없음 → 빈 배열.
 * @param {Array<{stockId:string, name?:string, return:number}>} p.returns
 *   그 라운드 연도 → 다음 연도 **등락률(%)**. 미상장·거래정지 종목은 호출부에서 제외.
 * @param {string[]} [p.grades]  grades[i] = i번째로 큰 변동에 줄 등급 (기본 S~D 5개).
 * @param {number}   [p.minMove] 이 %(절대값) 미만 변동은 힌트로 안 낸다 (기본 3).
 * @returns {Array<{round:number, grade:string, impact:'up'|'down', related_stock_ids:string[], headline:string}>}
 */
export function deriveRoundHints({ round, returns = [], grades = DEFAULT_HINT_GRADES, minMove = 3 }) {
  if (round <= 1) return []
  const seen = new Set()
  const movers = [...returns]
    .filter((x) => {
      if (!x || !Number.isFinite(x.return) || Math.abs(x.return) < minMove) return false
      if (seen.has(x.stockId)) return false
      seen.add(x.stockId)
      return true
    })
    .sort((a, b) => Math.abs(b.return) - Math.abs(a.return))
    .slice(0, grades.length)

  return movers.map((x, i) => {
    const impact = x.return > 0 ? 'up' : 'down'
    return {
      round,
      grade: grades[i],
      impact,
      related_stock_ids: [x.stockId],
      headline: hintHeadline(x.name ?? x.stockId, impact),
    }
  })
}
