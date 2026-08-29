import Modal from './Modal'
import { num } from '../format'

const PAD = { t: 20, r: 20, b: 32, l: 44 }
const W = 480
const H = 220

/**
 * 변동성 스마일(IV vs 행사가) 교육용 팝업. 실제 등록된 계약의 implied_vol을 그대로 쓴다 —
 * 가짜 곡선을 그리지 않는다. 계약이 1개뿐이면 점 하나만 찍히고(그게 사실이므로), 안내
 * 문구로 그 이유를 설명한다.
 *
 * @param {boolean} open
 * @param {() => void} onClose
 * @param {string} stockName
 * @param {{strike:number, implied_vol:number, option_type:string}[]} contracts
 */
export default function VolatilitySmileModal({ open, onClose, stockName, contracts }) {
  const points = (contracts ?? [])
    .map((c) => ({ strike: Number(c.strike), iv: Number(c.implied_vol) * 100, type: c.option_type }))
    .sort((a, b) => a.strike - b.strike)

  const strikes = points.map((p) => p.strike)
  const ivs = points.map((p) => p.iv)
  const xMin = strikes.length ? Math.min(...strikes) : 0
  const xMax = strikes.length ? Math.max(...strikes) : 1
  const yMin = ivs.length ? Math.min(...ivs, 0) : 0
  const yMax = ivs.length ? Math.max(...ivs) : 1

  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b
  const xToPx = (s) => PAD.l + (xMax === xMin ? plotW / 2 : ((s - xMin) / (xMax - xMin)) * plotW)
  const yToPx = (v) => PAD.t + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xToPx(p.strike).toFixed(1)} ${yToPx(p.iv).toFixed(1)}`).join(' ')

  return (
    <Modal open={open} onClose={onClose} title={`변동성 스마일 · ${stockName ?? ''}`}>
      <div className="vsmile">
        <p className="vsmile-intro">
          행사가(K)마다 옵션 프리미엄에 반영된 <b>내재변동성(IV)</b>을 나타낸 그래프예요. 실제 시장에서는
          등가격(현재가와 가까운 행사가)보다 <b>깊은 외가·내가에서 IV가 더 높게</b> 형성되는 경우가
          흔합니다 — 이 모양이 U자(또는 한쪽으로 기운 U자, "스큐")를 닮아서{' '}
          <b>"변동성 스마일(Volatility Smile)"</b>이라고 불러요. 극단적인 가격 변동에 대한 시장의
          위험 프리미엄이 반영된 결과로 해석돼요.
        </p>

        {points.length === 0 ? (
          <p className="vsmile-empty">이 종목엔 등록된 옵션 계약이 없어요.</p>
        ) : (
          <>
            <svg width={W} height={H} className="vsmile-svg" role="img" aria-label="변동성 스마일 차트">
              {[0, 0.5, 1].map((t) => {
                const y = yMin + (yMax - yMin) * t
                return (
                  <g key={t}>
                    <line x1={PAD.l} y1={yToPx(y)} x2={W - PAD.r} y2={yToPx(y)} className="vsmile-grid" />
                    <text x={PAD.l - 8} y={yToPx(y) + 4} className="vsmile-tick" textAnchor="end">
                      {y.toFixed(0)}%
                    </text>
                  </g>
                )
              })}
              {points.length > 1 && <path d={path} className="vsmile-line" fill="none" />}
              {points.map((p, i) => (
                <g key={i}>
                  <circle cx={xToPx(p.strike)} cy={yToPx(p.iv)} r={4} className={'vsmile-dot ' + p.type} />
                  <text x={xToPx(p.strike)} y={H - PAD.b + 16} className="vsmile-tick" textAnchor="middle">
                    ₩{num(p.strike)}
                  </text>
                </g>
              ))}
            </svg>
            {points.length === 1 && (
              <p className="vsmile-note">
                지금은 이 종목에 계약이 하나뿐이라 점 하나만 보여요. 강사 선생님이 행사가가 다른 계약을
                여러 개 등록하면 곡선(스마일) 모양이 나타나요.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
