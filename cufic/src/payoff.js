// 보호적 풋(Protective Put) 손익 계산 — 순수 함수만 둔다 (PayoffDiagram이 쓰고, 테스트가 직접 검사한다).
// 전부 "주당"(per share) 기준이다 — 수량 곱은 컴포넌트가 표시 단계에서 한다.

/** 헷지 없이 주식만 들고 있을 때의 주당 손익 */
export function spotPnlPerShare(spot, entrySpot) {
  return spot - entrySpot
}

/**
 * 보호적 풋(주식 + 풋 매수) 주당 손익.
 *   행사가 이상: 주식 손익과 같은 기울기, 프리미엄만큼 아래로 평행이동
 *   행사가 미만: (행사가-진입가)-프리미엄으로 고정 — 풋의 내재가치가 주식 하락을 정확히 상쇄한다
 */
export function hedgedPnlPerShare(spot, entrySpot, strike, premiumPerUnit) {
  const floor = floorLoss(entrySpot, strike, premiumPerUnit)
  const upside = spot - entrySpot - premiumPerUnit
  return spot < strike ? floor : upside
}

/** 바닥 방어 손익(행사가 이하 전 구간에서 항상 이 값) */
export function floorLoss(entrySpot, strike, premiumPerUnit) {
  return strike - entrySpot - premiumPerUnit
}

/** 손익분기점(행사가 이상 구간에서 헷지 손익이 0이 되는 지점) */
export function breakeven(entrySpot, premiumPerUnit) {
  return entrySpot + premiumPerUnit
}

/**
 * SVG 그리기용 좌표 배열 생성 — spot 범위를 points개 점으로 훑어 두 선(헷지 없음/보호적 풋)의
 * (spot, pnl) 쌍을 만든다. 화면(픽셀) 매핑은 컴포넌트가 한다 — chart.js의 priceAxis와 같은
 * 관심사 분리(데이터 계산과 좌표 변환을 나눠서 컴포넌트 없이 단위 테스트할 수 있게 한다).
 */
export function buildPayoffSeries(entrySpot, strike, premiumPerUnit, { min, max, points = 60 } = {}) {
  const lo = min ?? entrySpot * 0.5
  const hi = max ?? entrySpot * 1.5
  const n = Math.max(2, Math.floor(points))
  const step = (hi - lo) / (n - 1)

  const unhedged = []
  const hedged = []
  for (let i = 0; i < n; i++) {
    const s = lo + step * i
    unhedged.push([s, spotPnlPerShare(s, entrySpot)])
    hedged.push([s, hedgedPnlPerShare(s, entrySpot, strike, premiumPerUnit)])
  }
  return { unhedged, hedged, domain: { min: lo, max: hi } }
}
