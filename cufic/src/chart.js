// 참가자 차트의 가격 경로 생성기.
// 종목코드 + 시드 문자열을 시드로 쓰는 결정론적 난수라서, 같은 종목·같은 라운드 구간은
// 모든 학생 화면에서 항상 같은 모양이 나온다.

function hashSeed(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed) {
  let a = seed
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// '틱' 시간대에서 지금 라운드 구간이 실제로 몇 초마다 한 점씩 드러날지 — 여기 숫자만
// 바꾸면 세부 점 개수(Chart.jsx의 durationMs/SUB_TICK_INTERVAL_MS 역산)와 x축 좌표 폭이
// 자동으로 같이 맞춰진다(둘 다 이 상수 하나로 계산되므로 따로 손댈 곳이 없다).
export const SUB_TICK_INTERVAL_MS = 1_000

// 구간(라운드→라운드, 혹은 게임 시작 전→R1)마다 점 몇 개로 쪼갤지 + 점당 흔들림 폭.
// '틱'은 실시간 라이브 구간을 빠르게 확확 그려지게 하려고 넣은, 점이 가장 촘촘한 단위.
export const TIMEFRAMES = [
  { key: 'T', label: '틱', count: 60, vol: 0.01 },
  { key: 'D', label: '일', count: 40, vol: 0.012 },
  { key: 'W', label: '주', count: 32, vol: 0.028 },
  { key: 'M', label: '월', count: 24, vol: 0.055 },
  { key: 'Y', label: '년', count: 12, vol: 0.13 },
]

/**
 * fromPrice → toPrice 구간을 count개의 점으로 잇는다. 양 끝은 정확히 fromPrice·toPrice로
 * 고정하고(노이즈 없음) 중간만 로그(복리) 추세 + 노이즈를 얹는다 — 그래야 여러 구간을
 * 이어 붙였을 때 경계에서 값이 끊기지 않는다(다음 구간의 첫 점 = 이전 구간의 마지막 점).
 *
 * @param {string} seedKey  구간마다 다른 결정론적 시드 문자열
 * @param {number} fromPrice
 * @param {number} toPrice
 * @param {number} count    점 개수(최소 1)
 * @param {number} vol      점당 흔들림 폭(비율)
 * @returns {number[]}
 */
export function closePath(seedKey, fromPrice, toPrice, count, vol) {
  const n = Math.max(1, Math.floor(count))
  if (n === 1) return [toPrice]

  // 지수 보간(Math.pow)에 쓸 안전한 기준값 — 실제 값이 0이어도(거래정지) NaN 없이 굴러가게
  // 만들 뿐, 실제로 찍히는 첫·마지막 점은 항상 fromPrice·toPrice 그대로다(아래 i===0/n-1).
  const safeFrom = fromPrice > 0 ? fromPrice : toPrice > 0 ? toPrice : 1
  const safeTo = toPrice > 0 ? toPrice : safeFrom

  const rand = mulberry32(hashSeed(seedKey))
  const pts = []
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      pts.push(fromPrice)
      continue
    }
    if (i === n - 1) {
      pts.push(toPrice)
      continue
    }
    const t = i / (n - 1)
    const trend = safeFrom * Math.pow(safeTo / safeFrom, t)
    pts.push(trend * (1 + (rand() - 0.5) * 2 * vol))
  }
  return pts
}

/**
 * 게임이 시작되기 전(R1 이전) 가격 기록이 없을 때, 그래프의 왼쪽 끝을 그냥 R1가와
 * 똑같이 납작하게 두지 않도록 만드는 가상의 "R0" 기준점. 종목코드로만 결정되는
 * 고정값이라 새로고침해도 항상 같다 — 실제 데이터가 아니라 순수 장식용.
 *
 * @param {string} code
 * @param {number} r1Price
 * @returns {number}
 */
export function syntheticAnchor(code, r1Price) {
  if (!(r1Price > 0)) return 1
  const rand = mulberry32(hashSeed(code + ':R0'))
  const dev = (rand() - 0.5) * 2 * 0.12 // ±12%
  return Math.max(1, Math.round(r1Price * (1 - dev)))
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
  if (!path?.length) return { min: 0, max: 1, ticks: [] }
  const lo = Math.min(...path)
  const hi = Math.max(...path)
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.02 || 1
  const min = lo - pad
  const max = hi + pad
  return { min, max, ticks: niceTicks(min, max, count) }
}
