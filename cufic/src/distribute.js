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
