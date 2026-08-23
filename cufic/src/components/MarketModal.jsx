import { useState } from 'react'
import Modal from './Modal'
import { num } from '../format'
import { FIN_YEARS } from '../data'
import { MACRO_METRICS } from '../metrics'

/**
 * 시황판 — 연도별 시장 지표(주가지수 코스피·S&P500·일본·유럽 + 금리·물가·유가·금).
 * 재무제표 모달과 같은 디자인 언어: 연도 탭 + 6지표 콤팩트 표(한 화면) + 용어 접기.
 * 현재 라운드 연도까지만 공개(미래 스포일러 차단). 가격을 직접 움직이진 않는 '배경' 정보.
 */
export default function MarketModal({ open, onClose, round, macro }) {
  const years = FIN_YEARS.filter((y) => y <= round.year)
  const [year, setYear] = useState(years.at(-1) ?? round.year)
  const [openTerm, setOpenTerm] = useState(null) // 용어 전체 접기/펼치기
  const [openCell, setOpenCell] = useState(null) // 지표 셀 설명

  const sel = years.includes(year) ? year : (years.at(-1) ?? round.year)
  const cur = macro?.[sel]
  const fmt = (m, v) => (v == null ? '-' : m.unit === '%' ? v.toFixed(1) : num(v))

  return (
    <Modal open={open} onClose={onClose} title="시황판 · 시장 지표" wide>
      <p className="fs-meta">
        지수 = pt / 금리·물가 = % / 유가·금 = $ · {round.year}년까지 공개돼요.
        <br />
        지표는 종목 판단의 <b>배경</b>이에요 — 재무제표·힌트와 함께 살펴보세요.
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

      {cur?.summary && (
        <p className="fs-intro">
          <b>{sel}년</b> — {cur.summary}
        </p>
      )}

      <div className="fs-macro">
        {MACRO_METRICS.map((m) => (
          <button
            key={m.key}
            className={'fs-mcell' + (openCell === m.key ? ' on' : '')}
            onClick={() => setOpenCell(openCell === m.key ? null : m.key)}
          >
            <span className="fs-mlabel">
              {m.label} <span className="fs-q">?</span>
            </span>
            <span className="fs-mval num">
              {fmt(m, cur?.[m.key])}
              <em>{m.unit}</em>
            </span>
          </button>
        ))}
      </div>
      {openCell && <p className="fs-chipdesc">{MACRO_METRICS.find((m) => m.key === openCell)?.desc}</p>}

      <div className="fs-gloss">
        <button className="fs-gloss-h" onClick={() => setOpenTerm(openTerm === 'all' ? null : 'all')}>
          용어 설명 {openTerm === 'all' ? '▲' : '▼'}
        </button>
        {openTerm === 'all' && (
          <dl>
            {MACRO_METRICS.map((m) => (
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
