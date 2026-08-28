// 라운드 중 차트에 "실시간으로 살아있는" 느낌을 주는 흔들림 공식.
// 2026-08-26부터는 이 값 자체가 실제 체결가다 — 아래쪽 "[2026-08-26]" 주석 참고.
//
// [v2 — 라운드 시작 시각을 더 이상 역산하지 않는다]
// 처음엔 roundStartMs(=round_ends_at - round_duration_seconds)로 브라운 브리지를 짰는데,
// 관리자가 ±1분 버튼(adjust_round_timer)으로 타이머를 조정하면 round_ends_at만 바뀌고
// round_duration_seconds는 그대로라서 역산한 시작 시각이 실제와 어긋난다 — 그러면 τ가
// [0,T] 범위 밖으로 밀려 계속 0(=클램프)에 갇혀서 "흔들림이 아예 안 보이는" 버그가 됐다
// (리허설 중 타이머를 만졌다면 100% 재현된다).
//
// 그래서 지금은 "시작 시각"을 아예 안 쓴다 — 서버가 주는 유일하게 신뢰 가능한 값인
// remainingMs(=round_ends_at - now, place_order가 검사하는 것과 같은 기준)만으로
// 흔들림의 크기(envelope)를 정하고, 흔들림의 파형(위상)은 now 하나로만 계속 흐르게 한다.
// 타이머를 몇 번을 조정·재시작해도 remainingMs만 다시 계산되면 항상 올바르게 따라온다.
//
// [왜 다음 라운드 가격이 아니라 지금 가격 주변에서만 흔드는가]
// 다음 라운드 가격은 이미 DB(stocks.prices)에 들어있는 경우가 많다(콘텐츠를 미리 만들어
// 두므로). 그걸 목표값으로 쓰면 라운드가 끝나기도 전에 다음 등락 방향을 차트로 미리
// 보여주는 스포일러가 된다 — 재무제표·뉴스로 판단하게 만드는 이 게임의 취지에 어긋난다.
// 그래서 항상 "지금의 공식가"만 중심으로 흔들고, 라운드 마감 직전(taperMs)엔 그 공식가로
// 수렴시킨다. 평가금액(team_equity·리더보드)은 여전히 이 값을 참조하지 않는다 —
// 라운드 중 순위가 매초 흔들리지 않는다는 규칙(CLAUDE.md)은 유지한다.
//
// [2026-08-26] 실제 체결가는 이제 이 값을 참조한다. 이 파일의 공식은
// supabase/migrations/20260826000036_tick_price_function.sql의 private.tick_price()로
// 한 글자도 다르지 않게 이식돼 있고, place_order(20260826000037)가 서버에서 직접
// 그 함수를 다시 계산해 체결한다 — 클라이언트가 계산한 이 값을 그대로 신뢰하지 않는다
// (신뢰하면 학생이 원하는 가격을 임의로 서버에 보낼 수 있는 가격 조작 취약점이 된다).
// 이 파일의 상수(0x6d2b79f5·31·15·7·61·14·CYCLE_MS)를 고치면 저 SQL 함수도 반드시 같이
// 고쳐야 한다 — scripts/verify-tick-price-parity.mjs로 두 구현의 수치 일치를 확인한다.
//
// 모든 학생이 같은 시드(라운드 번호 + 종목코드)로 계산하므로, 새로고침하거나 다른
// 학생 화면에서 봐도 그 순간의 값이 정확히 같다 — 서버 왕복 없이 순수 클라이언트 계산.

function hashSeed(seed, stockId) {
  let h = (Number(seed) || 0) >>> 0
  const s = String(stockId)
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0
  }
  return h >>> 0
}

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 저주파 하모닉 몇 개를 고정 위상으로 합쳐 "부드러운" 노이즈를 만든다.
// 매번 완전히 새로 뽑는 난수 대신 이렇게 하면 값이 순간이동하지 않고 연속적으로 흐른다.
function harmonics(seed, stockId, n = 5) {
  const rand = mulberry32(hashSeed(seed, stockId))
  return Array.from({ length: n }, (_, i) => ({
    freq: i + 1,
    phase: rand() * Math.PI * 2,
    amp: 1 / (i + 1),
  }))
}

// phaseFrac: [0,1) 구간을 도는 위상. CYCLE_MS마다 한 바퀴 돈다.
//
// 47분 → 6분 → 2분으로 계속 줄여왔는데, "고빈도 실거래 단말기처럼" 더 빠르게 확확
// 움직이길 원해서 10초까지 줄였다. 지금은 realtimeTick이 전체 흐름(리빌)이 아니라 이미
// 드러난 지점의 미세 잔떨림만 담당해서 — 아무리 빨라도 sigma(진폭)가 1~2%로 작게
// 묶여 있어 튀어 보이지 않는다.
const CYCLE_MS = 10 * 1000 // 10초

function noiseAt(hs, phaseFrac) {
  let sum = 0
  let norm = 0
  for (const h of hs) {
    sum += h.amp * Math.sin(2 * Math.PI * h.freq * phaseFrac + h.phase)
    norm += h.amp
  }
  return norm > 0 ? sum / norm : 0
}

/**
 * 지금 이 순간의 "화면용" 실시간 틱 가격을 계산한다.
 * remainingMs가 taperMs 이하로 줄면 officialPrice로 수렴하고(라운드 마감 직전 안정화),
 * 그 전에는 항상 officialPrice 주변에서 흔들린다. round_ends_at이 관리자 조작으로
 * 몇 번을 바뀌어도(±1분 버튼 등) remainingMs만 다시 넣으면 항상 올바르게 반영된다.
 *
 * @param {object} p
 * @param {number} p.officialPrice  서버가 확정한 이번 라운드 공식가(place_order가 쓰는 값)
 * @param {number|string} p.seed    라운드마다 바뀌는 시드(보통 game.current_round)
 * @param {string} p.stockId        종목코드 — 종목마다 다른 파형이 나오게 한다
 * @param {number} [p.now]          평가 시각(기본 Date.now())
 * @param {number} p.remainingMs    라운드 마감까지 남은 시간(ms) — round_ends_at 기준, 0 이하면 마감
 * @param {number} [p.taperMs]      마감 직전 공식가로 수렴시키는 구간 길이(기본 15초)
 * @param {number} [p.sigma]        흔들림 폭(공식가 대비 비율, 기본 3%)
 * @returns {number} 정수 원 단위 가격(최소 1)
 */
export function tickPrice({ officialPrice, seed, stockId, now, remainingMs, taperMs = 15_000, sigma = 0.03 }) {
  const t = now ?? Date.now()
  if (!officialPrice || officialPrice <= 0) {
    return Math.max(1, Math.round(officialPrice || 0))
  }
  const remain = Math.max(0, remainingMs ?? 0)
  const envelope = taperMs > 0 ? Math.min(1, remain / taperMs) : remain > 0 ? 1 : 0
  if (envelope <= 0) return Math.max(1, Math.round(officialPrice))

  const phaseFrac = ((t % CYCLE_MS) + CYCLE_MS) % CYCLE_MS / CYCLE_MS
  const z = noiseAt(harmonics(seed, stockId), phaseFrac)
  const wiggle = officialPrice * sigma * envelope * z
  return Math.max(1, Math.round(officialPrice + wiggle))
}
