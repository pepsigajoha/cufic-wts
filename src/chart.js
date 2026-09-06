// 참가자 차트의 좌표 계산 + 장중 경로 보조 함수.
//
// 예전엔 여기서 closePath()로 연도별 끝점 사이를 "가짜"로 이어 그렸다. 이제는 서버가
// stock_price_paths에 저장한 실제 252일 시뮬레이션 경로를 그대로 쓴다(20260830000043).
// 이 파일에는 순수 계산만 남긴다 — 경로 자체는 gameData.buildStocks가 넘겨준다.

// 라운드(=1년) 한 판의 시뮬레이션 스텝 수. priceSim.simulateNextRound(stepsPerYear)와,
// SQL private.round_step_idx()의 *252 와 반드시 같아야 한다.
export const STEPS_PER_YEAR = 252

// 타임프레임: 한 라운드(=1년)를 몇 개 점으로 그릴지(count) + 과거 몇 개 연도까지 보여줄지(window).
//  - 틱  : 최대 해상도(252) · 지금 라운드에 바짝 확대 → 팁이 자주·빠르게 전진
//  - 년  : 12점만 · 전체 연도 → 팁이 드물게·크게 전진(느린 캔들 느낌)
// 지금 진행 중인 라운드도 count로 다운샘플하고, reveal도 count 단위로 끊어 드러낸다.
export const TIMEFRAMES = [
  { key: 'T', label: '틱', count: STEPS_PER_YEAR, window: 1 },
  { key: 'D', label: '일', count: 60, window: 2 },
  { key: 'W', label: '주', count: 32, window: 3 },
  { key: 'M', label: '월', count: 24, window: 4 },
  { key: 'Y', label: '년', count: 12, window: 99 },
]

/**
 * 라운드 진행률 → 스텝 인덱스(0..STEPS_PER_YEAR-1). SQL private.round_step_idx()와 동일 공식.
 * round_start_at / round_ends_at 이 없거나 잠겨 있으면 마지막 스텝(연말가)을 가리킨다.
 *
 * @param {{round_start_at?:string, round_ends_at?:string, is_locked?:boolean}} game
 * @param {number} nowMs  Date.now()
 * @returns {number}
 */
export function roundStepIndex(game, nowMs = Date.now()) {
  const last = STEPS_PER_YEAR - 1
  const start = Date.parse(game?.round_start_at ?? '')
  const end = Date.parse(game?.round_ends_at ?? '')
  if (!Number.isFinite(start) || !Number.isFinite(end) || game?.is_locked) return last
  const span = end - start
  if (!(span > 0)) return last
  // 일시정지(0049) 중이면 그 시각에서 진행률을 얼린다 — SQL private.round_step_idx()와 동일.
  const paused = Date.parse(game?.round_paused_at ?? '')
  const effNow = Number.isFinite(paused) ? paused : nowMs
  const frac = (effNow - start) / span
  return Math.max(0, Math.min(last, Math.floor(frac * STEPS_PER_YEAR)))
}

/**
 * 경로를 n개의 대표점으로 줄인다(첫·마지막 점은 항상 포함). 과거 라운드를 일/주/월 해상도로
 * 그릴 때 쓴다. n이 경로 길이 이상이면 그대로 돌려준다.
 * @param {number[]} path
 * @param {number} n
 * @returns {number[]}
 */
export function downsample(path, n) {
  if (!Array.isArray(path) || path.length === 0) return []
  const target = Math.max(1, Math.floor(n))
  if (target >= path.length) return path.slice()
  if (target === 1) return [path[path.length - 1]]
  const out = []
  for (let i = 0; i < target; i++) {
    out.push(path[Math.round((i / (target - 1)) * (path.length - 1))])
  }
  return out
}

// y축 눈금을 깔끔한 라운드 숫자로 (1,511 대신 1,500·2,000 …). 자릿수에 맞춰 간격을 고른다.
function niceTicks(min, max, count = 5) {
  const range = max - min || 1
  const raw = range / (count - 1)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / mag
  const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag
  const out = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 0.001; v += step) out.push(v)
  return out
}

/**
 * 가격 경로(순수 숫자 배열)에서 y축 도메인(min/max)과 눈금을 뽑는 순수 함수. Chart.jsx는
 * 이 결과로 픽셀 좌표만 계산한다 — 데이터 스케일링과 화면 매핑을 분리해 좌표 계산을
 * 컴포넌트 없이 단위 테스트할 수 있게 한다.
 *
 * 값이 전부 같아도(변동성 0) `max - min`이 0이 되지 않도록 최소 여백을 보장한다
 * (0으로 나누면 y좌표가 NaN이 돼 SVG path가 깨진다).
 *
 * @param {number[]} path
 * @param {number} [count] 눈금 개수
 * @returns {{min:number, max:number, ticks:number[]}}
 */
export function priceAxis(path, count = 5) {
  const clean = (path ?? []).filter((v) => Number.isFinite(v))
  if (!clean.length) return { min: 0, max: 1, ticks: [] }
  const lo = Math.min(...clean)
  const hi = Math.max(...clean)
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.02 || 1
  const min = lo - pad
  const max = hi + pad
  return { min, max, ticks: niceTicks(min, max, count) }
}
