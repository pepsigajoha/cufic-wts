import { useMemo } from 'react'
import { num, signed } from '../format'
import { useSize } from '../useSize'
import { buildPayoffSeries, floorLoss, breakeven } from '../payoff'

const PAD = { t: 24, r: 70, b: 24, l: 14 }

/**
 * 보호적 풋 헷지의 실시간 손익 다이어그램(SVG). 좌표 계산은 payoff.js(순수 함수)가 하고,
 * 이 컴포넌트는 픽셀 매핑과 그리기만 담당한다(Chart.jsx/chart.js와 같은 관심사 분리).
 *
 * @param {object} stock  선택된 종목(현재가·이름 포함, App.jsx의 buildStocks 결과)
 * @param {object|null} contract  선택된 옵션 계약(strike 등)
 * @param {number} premiumPerUnit  실시간 조회된 주당 프리미엄(quote_option_premium 결과)
 * @param {number} quantity  주문 패널에서 입력 중인 수량(0이면 1주 기준으로 보여준다)
 */
export default function PayoffDiagram({ stock, contract, premiumPerUnit, quantity }) {
  const [wrapRef, { w, h }] = useSize()
  const entrySpot = stock?.price ?? 0
  const strike = contract?.strike ?? entrySpot
  const premium = premiumPerUnit || 0
  const qty = quantity > 0 ? quantity : 1

  const { unhedged, hedged, domain } = useMemo(
    () => buildPayoffSeries(entrySpot, strike, premium),
    [entrySpot, strike, premium],
  )

  const plotW = Math.max(w - PAD.l - PAD.r, 1)
  const plotH = Math.max(h - PAD.t - PAD.b, 1)

  const allY = [...unhedged.map((p) => p[1]), ...hedged.map((p) => p[1]), 0]
  const yMin = Math.min(...allY)
  const yMax = Math.max(...allY)
  const yPad = (yMax - yMin) * 0.15 || 1
  const yLo = yMin - yPad
  const yHi = yMax + yPad

  const xToPx = (s) => PAD.l + ((s - domain.min) / (domain.max - domain.min || 1)) * plotW
  const yToPx = (v) => PAD.t + (1 - (v - yLo) / (yHi - yLo || 1)) * plotH

  const pathOf = (series) =>
    series.map(([s, v], i) => `${i === 0 ? 'M' : 'L'} ${xToPx(s).toFixed(1)} ${yToPx(v).toFixed(1)}`).join(' ')

  const floor = floorLoss(entrySpot, strike, premium)
  const be = breakeven(entrySpot, premium)
  const zeroY = yToPx(0)
  const strikeX = xToPx(strike)
  const floorY = yToPx(floor)
  const beX = Math.min(Math.max(xToPx(be), PAD.l), w - PAD.r)

  const hasData = w > 0 && h > 0 && entrySpot > 0

  return (
    <main className="col chart hedge" ref={wrapRef}>
      <div className="hedge-head">
        <span className="hnm">{stock ? stock.name : '종목을 선택하세요'}</span>
        {contract && (
          <span className="hmeta">
            {contract.option_type === 'put' ? '풋' : '콜'} · 행사가 ₩{num(strike)} · R{contract.expiry_round} 만기
            {premium > 0 && ` · 프리미엄 ₩${num(premium)}/주`}
          </span>
        )}
      </div>

      {hasData ? (
        <svg width={w} height={h} className="payoff-svg" role="img" aria-label="보호적 풋 헷지 손익 다이어그램">
          <line x1={PAD.l} y1={zeroY} x2={w - PAD.r} y2={zeroY} className="payoff-axis-zero" />
          <line x1={strikeX} y1={PAD.t} x2={strikeX} y2={h - PAD.b} className="payoff-axis-strike" />
          <line x1={PAD.l} y1={floorY} x2={w - PAD.r} y2={floorY} className="payoff-axis-floor" />

          <path d={pathOf(unhedged)} className="payoff-line unhedged" fill="none" />
          <path d={pathOf(hedged)} className="payoff-line hedged" fill="none" />

          <circle cx={beX} cy={zeroY} r={4} className="payoff-marker" />

          <text x={strikeX} y={PAD.t - 8} className="payoff-label" textAnchor="middle">
            행사가 ₩{num(strike)}
          </text>
          <text x={w - PAD.r} y={floorY - 6} className="payoff-label floor" textAnchor="end">
            최대손실(주당) {signed(floor)}
          </text>
          <text x={beX} y={zeroY - 8} className="payoff-label breakeven" textAnchor="middle">
            손익분기 ₩{num(be)}
          </text>
        </svg>
      ) : (
        <div className="payoff-empty">종목과 옵션 계약을 선택하면 손익 곡선이 그려져요.</div>
      )}

      <div className="hedge-legend">
        <span className="lg unhedged">
          <i className="sw dotted" /> 헷지 없이 주식만 ({qty}주 기준)
        </span>
        <span className="lg hedged">
          <i className="sw solid" /> 보호적 풋 헷지
        </span>
      </div>
    </main>
  )
}
