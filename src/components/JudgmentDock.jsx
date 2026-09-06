import { useState } from 'react'
import { num } from '../format'
import { deriveFinancials, MACRO_METRICS } from '../metrics'

// 판단 근거 도크 — 차트 아래 붙는 요약 스트립.
// 재무·시황·힌트의 "핵심 몇 줄"만 눈앞에 두고, 상세는 기존 모달로 넘긴다(자세히 →).
// 데이터·계산은 모달과 같은 소스(metrics.js, deriveFinancials)를 그대로 쓴다 — 새 규칙 없음.

const GRADE_ORDER = { S: 0, A: 1, B: 2, C: 3, D: 4 }

// 전년 대비 방향. 값이 없으면 화살표 없음.
function trend(cur, prev) {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return { cls: '', arw: '' }
  const d = cur - prev
  return d > 0 ? { cls: 'up', arw: '▲' } : d < 0 ? { cls: 'down', arw: '▼' } : { cls: 'flat', arw: '–' }
}

const eok = (v) => (Number.isFinite(v) ? num(v) : '—')
const asPct = (v) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(1) + '%')

function Stat({ label, value, unit, arw, cls }) {
  return (
    <div className="jd-stat">
      <span className="jd-k">{label}</span>
      <span className={'jd-v num' + (cls ? ' ' + cls : '')}>
        {arw && (
          <span className="jd-arw" aria-hidden="true">
            {arw}{' '}
          </span>
        )}
        {value}
        {unit && <em>{unit}</em>}
      </span>
    </div>
  )
}

/** year 이하에서 자료가 있는 가장 최근 해(+ 그 전 해) */
function latestYears(byYear, year) {
  const ys = Object.keys(byYear ?? {})
    .map(Number)
    .filter((y) => y <= year)
    .sort((a, b) => a - b)
  return [ys.at(-1), ys.at(-2)]
}

function FinSummary({ stock, financials, year, onOpen }) {
  const byYear = stock ? financials?.[stock.code] : null
  const [y, py] = latestYears(byYear, year)
  const f = deriveFinancials(byYear?.[y])
  const pf = deriveFinancials(byYear?.[py])

  if (!f) {
    return (
      <div className="jd-empty">
        {year >= 2000 ? `${year}년까지 ` : ''}공개된 재무 자료가 없어요.
        {onOpen && (
          <button className="jd-more" onClick={onOpen}>
            재무제표 열기 →
          </button>
        )}
      </div>
    )
  }
  const rev = trend(f.revenue, pf?.revenue)
  const oiCls = f.operatingIncome < 0 ? 'down' : f.operatingIncome > 0 ? 'up' : 'flat'
  return (
    <>
      <div className="jd-stats">
        <Stat label="매출" value={eok(f.revenue)} unit="억" arw={rev.arw} cls={rev.cls} />
        <Stat label="영업이익" value={eok(f.operatingIncome)} unit="억" cls={oiCls} />
        <Stat label="부채비율" value={asPct(f.debtRatio)} />
        <Stat label="ROE" value={asPct(f.roe)} />
      </div>
      <div className="jd-foot">
        <span className="jd-note">
          {y}년 기준 · 화살표 = 전년 대비
          {f.impaired && <span className="jd-warn"> · ⚠ 자본잠식</span>}
        </span>
        {onOpen && (
          <button className="jd-more" onClick={onOpen}>
            재무제표 자세히 →
          </button>
        )}
      </div>
    </>
  )
}

function MacroSummary({ macro, year, onOpen }) {
  const [y, py] = latestYears(macro, year)
  const cur = macro?.[y]
  const prev = macro?.[py]
  if (!cur) {
    return (
      <div className="jd-empty">
        {year >= 2000 ? `${year}년까지 ` : ''}공개된 시황 자료가 없어요.
        {onOpen && (
          <button className="jd-more" onClick={onOpen}>
            시황판 열기 →
          </button>
        )}
      </div>
    )
  }
  const pick = ['rate', 'cpi', 'kospi', 'oil']
  return (
    <>
      {cur.summary && <p className="jd-lead">{cur.summary}</p>}
      <div className="jd-stats">
        {pick.map((k) => {
          const m = MACRO_METRICS.find((x) => x.key === k)
          const v = cur[k]
          const t = trend(v, prev?.[k])
          const disp = m.unit === '%' ? (Number.isFinite(v) ? v.toFixed(1) : '—') : eok(v)
          return <Stat key={k} label={m.label} value={disp} unit={m.unit} arw={t.arw} cls={t.cls} />
        })}
      </div>
      <div className="jd-foot">
        <span className="jd-note">{y}년 기준 · 화살표 = 전년 대비</span>
        {onOpen && (
          <button className="jd-more" onClick={onOpen}>
            시황판 자세히 →
          </button>
        )}
      </div>
    </>
  )
}

function HintSummary({ hints, onOpen }) {
  if (!hints.length) {
    return <div className="jd-empty">아직 받은 힌트가 없어요. 선생님이 나눠주면 여기에 나타나요.</div>
  }
  const top = hints[0]
  return (
    <>
      <article className="jd-hint">
        <span className={'grade g' + top.grade}>{top.grade}</span>
        <p className="jd-hl">{top.headline}</p>
      </article>
      <div className="jd-foot">
        <span className="jd-note">
          {hints.length > 1 ? `이 힌트 외 ${hints.length - 1}개 더 있어요` : '받은 힌트 1개'}
        </span>
        <button className="jd-more" onClick={onOpen}>
          힌트 전체 보기 →
        </button>
      </div>
    </>
  )
}

export default function JudgmentDock({
  stock,
  financials,
  macro,
  round,
  hints,
  onOpenFinancial,
  onOpenMarket,
  onOpenHints,
}) {
  const [tab, setTab] = useState('fin')
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('wts-dock') !== 'closed'
    } catch {
      return true
    }
  })
  const toggle = () =>
    setOpen((o) => {
      const next = !o
      try {
        localStorage.setItem('wts-dock', next ? 'open' : 'closed')
      } catch {
        /* 시크릿 모드 등 — 세션 내에서만 유지 */
      }
      return next
    })

  const year = round?.year ?? 0
  const myHints = [...(hints ?? [])].sort(
    (a, b) => GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade] || b.id - a.id,
  )

  const TABS = [
    ['fin', '재무 요약'],
    ['macro', '시황 요약'],
    ['hint', '힌트'],
  ]

  return (
    <section className={'jdock' + (open ? '' : ' collapsed')} aria-label="판단 근거">
      <div className="jd-tabs" role="tablist" aria-label="판단 근거">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={'jd-tab' + (tab === key ? ' on' : '')}
            onClick={() => {
              setTab(key)
              if (!open) toggle()
            }}
          >
            {label}
            {key === 'hint' && myHints.length > 0 && <b className="num">{myHints.length}</b>}
          </button>
        ))}
        <button
          className="jd-toggle"
          onClick={toggle}
          aria-expanded={open}
          aria-label={open ? '판단 근거 접기' : '판단 근거 펼치기'}
        >
          {open ? '▾' : '▴'}
        </button>
      </div>

      {open && (
        <div className="jd-body" role="tabpanel">
          {tab === 'fin' && (
            <FinSummary stock={stock} financials={financials} year={year} onOpen={onOpenFinancial} />
          )}
          {tab === 'macro' && <MacroSummary macro={macro} year={year} onOpen={onOpenMarket} />}
          {tab === 'hint' && <HintSummary hints={myHints} onOpen={onOpenHints} />}
        </div>
      )}
    </section>
  )
}
