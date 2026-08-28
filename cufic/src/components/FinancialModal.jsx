import { useState } from 'react'
import Modal from './Modal'
import { num } from '../format'
import { FIN_YEARS } from '../data'
import { FIN_INPUTS, FIN_DERIVED, deriveFinancials } from '../metrics'

// 비용/적자(음수)는 파란 괄호로. 그 외는 일반 숫자.
function Money({ v, cost }) {
  const neg = v < 0
  if (cost || neg) return <span className="fs-paren num">({num(Math.abs(v))})</span>
  return <span className="num">{num(v)}</span>
}

const ratio = (v) => (v == null ? '—' : v.toFixed(1) + '%')

export default function FinancialModal({ open, onClose, stock, round, financials }) {
  // 스포일러 방지: 현재 라운드 연도까지만
  const years = FIN_YEARS.filter((y) => y <= round.year)
  const data = stock ? financials?.[stock.code] : null
  // 기본 선택 연도 = 자료가 있는 가장 최근 연도(없으면 가장 최근 연도)
  const withData = years.filter((y) => data?.[y])
  const defaultYear = (withData.length ? withData : years).at(-1) ?? years.at(-1)
  const [year, setYear] = useState(defaultYear)
  const [openTerm, setOpenTerm] = useState(null) // 용어 접기/펼치기 전체
  const [openChip, setOpenChip] = useState(null) // 파생 칩 설명

  if (!stock) return null

  const sel = years.includes(year) ? year : defaultYear
  const f = deriveFinancials(data?.[sel])
  const debtDesc = FIN_DERIVED.find((m) => m.key === 'debtRatio')
  const roeDesc = FIN_DERIVED.find((m) => m.key === 'roe')

  return (
    <Modal open={open} onClose={onClose} title={`${stock.name} 재무제표`} wide>
      {stock.desc && (
        <p className="fs-intro">
          <b>{stock.name}</b> — {stock.desc}
        </p>
      )}
      <p className="fs-meta">
        단위: 억원 · <span className="down">파란 괄호 (—)</span>는 비용/적자예요 · {round.year}년까지 공시된
        자료예요
        <br />
        재무상태표는 “그 시점의 재산 상태”, 손익계산서는 “1년 동안의 장사 성적표”예요.
      </p>

      {years.length > 0 && (
        <div className="fs-tabs">
          {years.map((y) => (
            <button key={y} className={y === sel ? 'on' : ''} onClick={() => setYear(y)}>
              {y}년
            </button>
          ))}
        </div>
      )}

      {!f ? (
        <p className="fs-meta">{sel}년은 아직 등록된 재무 자료가 없어요.</p>
      ) : (
        <>
          <div className="fs-sheets">
            {/* 재무상태표 — T자형 */}
            <div className="fs-sheet">
              <h3 className="fs-h3">재무상태표</h3>
              <div className="fs-sub num">{sel}. 12. 31 기준</div>
              <div className="fs-tform">
                <div className="fs-tcol left">
                  <div className="fs-row top">
                    <span>자산</span>
                    <Money v={f.assets} />
                  </div>
                  <div className="fs-row sub-item">
                    <span>유동자산</span>
                    <Money v={f.currentAssets} />
                  </div>
                  <div className="fs-row sub-item">
                    <span>비유동자산</span>
                    <Money v={f.noncurrentAssets} />
                  </div>
                </div>
                <div className="fs-tcol">
                  <div className="fs-row top">
                    <span>부채</span>
                    <Money v={f.liabilities} />
                  </div>
                  <div className="fs-row sub-item">
                    <span>유동부채</span>
                    <Money v={f.currentLiabilities} />
                  </div>
                  <div className="fs-row sub-item">
                    <span>비유동부채</span>
                    <Money v={f.noncurrentLiabilities} />
                  </div>
                  <div className="fs-divider" />
                  <div className="fs-row capital">
                    <span>자본{f.impaired ? ' ⚠' : ''}</span>
                    <Money v={f.equity} />
                  </div>
                </div>
                <div className="fs-eqnote num">
                  자산({num(f.assets)}) = 부채({num(f.liabilities)}) + 자본({num(f.equity)}) — 항상
                  같아요!
                </div>
              </div>
            </div>

            {/* 손익계산서 — 단계 차감 */}
            <div className="fs-sheet">
              <h3 className="fs-h3">손익계산서</h3>
              <div className="fs-sub num">
                {sel}. 1. 1 ~ {sel}. 12. 31
              </div>
              <div className="fs-pl">
                <div className="fs-row top">
                  <span>매출</span>
                  <Money v={f.revenue} />
                </div>
                <div className="fs-row sub-item">
                  <span>영업비용</span>
                  <Money v={f.operatingExpense} cost />
                </div>
                <div className="fs-row result">
                  <span>영업이익</span>
                  <Money v={f.operatingIncome} />
                </div>
                <div className="fs-row sub-item">
                  <span>영업외비용</span>
                  <Money v={f.nonoperatingExpense} cost />
                </div>
                <div className="fs-row result final">
                  <span>당기순이익</span>
                  <Money v={f.netIncome} />
                </div>
              </div>
            </div>
          </div>

          {/* 파생 지표 */}
          <div className="fs-derived">
            <span className="fs-dlbl">이 표에서 계산한 지표</span>
            <button className="fs-chip" onClick={() => setOpenChip(openChip === 'debtRatio' ? null : 'debtRatio')}>
              부채비율 <b className="num">{ratio(f.debtRatio)}</b> <span className="fs-q">?</span>
            </button>
            <button className="fs-chip" onClick={() => setOpenChip(openChip === 'roe' ? null : 'roe')}>
              ROE <b className="num">{ratio(f.roe)}</b> <span className="fs-q">?</span>
            </button>
            {f.impaired && <span className="fs-badge">자본잠식 (자본이 0 이하)</span>}
          </div>
          {openChip === 'debtRatio' && <p className="fs-chipdesc">{debtDesc?.desc}</p>}
          {openChip === 'roe' && <p className="fs-chipdesc">{roeDesc?.desc}</p>}
        </>
      )}

      {/* 용어 설명 (접기/펼치기) */}
      <div className="fs-gloss">
        <button className="fs-gloss-h" onClick={() => setOpenTerm(openTerm === 'all' ? null : 'all')}>
          용어 설명 {openTerm === 'all' ? '▲' : '▼'}
        </button>
        {openTerm === 'all' && (
          <dl>
            {[...FIN_INPUTS, ...FIN_DERIVED].map((m) => (
              <div className="fs-g" key={m.key}>
                <b>{m.label}</b> — {m.desc}
              </div>
            ))}
          </dl>
        )}
      </div>
    </Modal>
  )
}
