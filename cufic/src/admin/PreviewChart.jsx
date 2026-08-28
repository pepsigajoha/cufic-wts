import { useState } from 'react'
import { num, pct, dirOf } from '../format'

// 순수 SVG 다중 라인 차트. 외부 차트 라이브러리 의존성 없음(viewBox 기반이라 반응형).
const WIDTH = 720
const HEIGHT = 300
const PAD = { top: 16, right: 16, bottom: 26, left: 58 }
const innerW = WIDTH - PAD.left - PAD.right
const innerH = HEIGHT - PAD.top - PAD.bottom

/**
 * @param {string[]} years
 * @param {Array<{id, name, color, values: Array<{year, price, yoy: number|null, confirmed?: boolean}>}>} series
 *   confirmed가 false인 점은 "아직 반영 안 된 예측치"로 그려진다(점선 구간 + 강조된 점).
 *   confirmed를 안 주면(배치 모드) 전부 확정 값으로 취급해 기존과 동일하게 실선으로 그린다.
 */
export default function PreviewChart({ years, series }) {
  const [hover, setHover] = useState(null) // { si, i }

  if (series.length === 0) {
    return <div className="sim-chart-empty">표시할 종목을 선택해주세요.</div>
  }

  const allPrices = series.flatMap((s) => s.values.map((v) => v.price))
  const rawMin = Math.min(...allPrices)
  const rawMax = Math.max(...allPrices)
  const pad = (rawMax - rawMin) * 0.08 || Math.max(rawMax * 0.1, 1)
  const yMin = Math.max(0, rawMin - pad)
  const yMax = rawMax + pad

  const xFor = (i) => PAD.left + (years.length > 1 ? (i / (years.length - 1)) * innerW : innerW / 2)
  const yFor = (v) => PAD.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH

  const active = hover ? series[hover.si] : null
  const activePoint = active ? active.values[hover.i] : null

  return (
    <div className="sim-chart-wrap">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="sim-chart" role="img" aria-label="시뮬레이션 미리보기 차트">
        {[0, 1, 2, 3, 4].map((k) => {
          const v = yMin + ((yMax - yMin) * k) / 4
          const y = yFor(v)
          return (
            <g key={k}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} className="sim-grid" />
              <text x={PAD.left - 8} y={y} className="sim-axis" textAnchor="end" dominantBaseline="middle">
                {num(v)}
              </text>
            </g>
          )
        })}
        {years.map((y, i) => (
          <text key={y} x={xFor(i)} y={HEIGHT - PAD.bottom + 18} className="sim-axis" textAnchor="middle">
            {y}
          </text>
        ))}

        {series.map((s) => {
          // 확정 구간(실선)과 예측 구간(점선)을 나눠 그린다. 예측 구간은 마지막 확정점에서
          // 이어져야 끊겨 보이지 않으므로, 마지막 확정점을 예측 구간의 시작점으로도 포함한다.
          const firstForecastIdx = s.values.findIndex((v) => v.confirmed === false)
          const confirmedPts = firstForecastIdx === -1 ? s.values : s.values.slice(0, firstForecastIdx)
          const forecastPts = firstForecastIdx === -1 ? [] : s.values.slice(Math.max(0, firstForecastIdx - 1))
          return (
            <g key={s.id}>
              {confirmedPts.length > 1 && (
                <polyline
                  points={confirmedPts.map((v, i) => `${xFor(i)},${yFor(v.price)}`).join(' ')}
                  className="sim-line"
                  style={{ stroke: s.color }}
                  fill="none"
                />
              )}
              {forecastPts.length > 1 && (
                <polyline
                  points={forecastPts
                    .map((v) => s.values.indexOf(v))
                    .map((i) => `${xFor(i)},${yFor(s.values[i].price)}`)
                    .join(' ')}
                  className="sim-line sim-line-forecast"
                  style={{ stroke: s.color }}
                  fill="none"
                />
              )}
            </g>
          )
        })}

        {series.map((s, si) =>
          s.values.map((v, i) => {
            const forecast = v.confirmed === false
            const isActive = hover && hover.si === si && hover.i === i
            return (
              <circle
                key={`${s.id}-${v.year}`}
                cx={xFor(i)}
                cy={yFor(v.price)}
                r={isActive ? 6 : forecast ? 5 : 3}
                className={'sim-point' + (forecast ? ' sim-point-forecast' : '')}
                style={{ fill: s.color }}
                onMouseEnter={() => setHover({ si, i })}
                onMouseLeave={() => setHover(null)}
              >
                <title>
                  {s.name} · {v.year}
                  {forecast ? ' (예측)' : ''}: {num(v.price)}원{v.yoy != null ? ` (${pct(v.yoy)})` : ''}
                </title>
              </circle>
            )
          }),
        )}
      </svg>

      {active && activePoint && (
        <div
          className="sim-tooltip"
          style={{ left: `${(xFor(hover.i) / WIDTH) * 100}%`, top: `${(yFor(activePoint.price) / HEIGHT) * 100}%` }}
        >
          <b>{active.name}</b> · {activePoint.year}
          {activePoint.confirmed === false && <span className="sim-forecast-tag">예측</span>}
          <div>{num(activePoint.price)}원</div>
          {activePoint.yoy != null && <div className={dirOf(activePoint.yoy)}>{pct(activePoint.yoy)}</div>}
        </div>
      )}

      <div className="sim-legend">
        {series.map((s) => (
          <span key={s.id} className="sim-legend-item">
            <i style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  )
}
