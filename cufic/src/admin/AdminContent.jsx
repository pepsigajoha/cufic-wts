import { useMemo, useState } from 'react'
import { errorText } from '../supabase'
import { num } from '../format'
import { FIN_INPUTS, deriveFinancials, MACRO_METRICS } from '../metrics'

// 게임에 등장하는 연도 = 라운드 연도 + 최종 연도
const yearsOf = (game) => {
  if (!game) return []
  const ys = new Set(Object.values(game.round_year_map ?? {}).map(Number))
  if (game.final_year != null) ys.add(Number(game.final_year))
  return [...ys].sort((a, b) => a - b)
}

function MacroRow({ year, row, onSave, busy }) {
  const [d, setD] = useState({
    summary: row?.summary ?? '',
    kospi: row?.kospi ?? '',
    sp500: row?.sp500 ?? '',
    nikkei: row?.nikkei ?? '',
    europe: row?.europe ?? '',
    rate: row?.rate ?? '',
    cpi: row?.cpi ?? '',
    oil: row?.oil ?? '',
    gold: row?.gold ?? '',
  })
  const set = (k, v) => setD((p) => ({ ...p, [k]: v }))
  return (
    <div className="macro-item">
      {/* 숫자 지표 행 */}
      <div className="content-row macro">
        <span className="cr-year">{year}년</span>
        {MACRO_METRICS.map((m) => (
          <input
            key={m.key}
            className="cr-num num"
            type="number"
            step="any"
            value={d[m.key]}
            onChange={(e) => set(m.key, e.target.value)}
            title={`${m.label} (${m.unit})`}
            placeholder={m.unit}
          />
        ))}
        <button className="act-btn prime sm" disabled={busy} onClick={() => onSave(year, d)}>
          저장
        </button>
      </div>
      {/* 한 줄 시황 — 전용 행(전체 폭) */}
      <input
        className="cr-summary-full"
        value={d.summary}
        onChange={(e) => set('summary', e.target.value)}
        placeholder={`${year}년 한 줄 시황 (예: 인플레이션 급등, 금리 인상 시작)`}
      />
    </div>
  )
}

function FinRow({ stockId, year, row, onSave, onDelete, busy }) {
  // 입력은 잎 7개만. 자산합계·자본·이익·비율은 아래에서 실시간 계산해 보여준다(저장 안 함).
  const [d, setD] = useState(() => Object.fromEntries(FIN_INPUTS.map((m) => [m.key, row?.[m.db] ?? ''])))
  const set = (k, v) => setD((p) => ({ ...p, [k]: v }))
  const empty = Object.values(d).every((v) => v === '' || v == null)
  const c = deriveFinancials(Object.fromEntries(FIN_INPUTS.map((m) => [m.key, Number(d[m.key]) || 0])))
  return (
    <div className="content-row fin">
      <span className="cr-year">{year}년</span>
      {FIN_INPUTS.map((m) => (
        <input
          key={m.key}
          className="cr-num num"
          type="number"
          step="any"
          value={d[m.key]}
          onChange={(e) => set(m.key, e.target.value)}
          title={`${m.label} (${m.unit})`}
          placeholder={m.unit}
        />
      ))}
      <span className="cr-calc num" title="입력값으로 자동 계산 (저장 안 됨)">
        자본 {num(c.equity)} · 순익 {num(c.netIncome)} · 부채{c.debtRatio == null ? '—' : Math.round(c.debtRatio) + '%'} · ROE {c.roe == null ? '—' : Math.round(c.roe) + '%'}
        {c.impaired && <b className="warn"> ⚠자본잠식</b>}
      </span>
      <span className="cr-actions">
        <button className="act-btn prime sm" disabled={busy || empty} onClick={() => onSave(stockId, year, d)}>
          저장
        </button>
        <button
          className="text-btn danger tiny"
          disabled={busy || !row}
          onClick={() => onDelete(stockId, year)}
          title="이 해를 미상장/폐지로(행 삭제)"
        >
          비움
        </button>
      </span>
    </div>
  )
}

/**
 * 재무제표·시황 편집 (콘텐츠 B). DB의 financials·macro를 관리자 화면에서 직접 고친다.
 * 저장하면 content_changed 신호로 학생 화면이 새 값을 받는다.
 * 표는 단일 그리드 — 행별 가로 스크롤 없이 한 화면에 들어온다(넘치면 표 전체가 한 번만 스크롤).
 */
export default function AdminContent({ actions, game, stocks, financials, macro, refresh, notify }) {
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState('')

  const years = useMemo(() => yearsOf(game), [game])
  const macroByYear = useMemo(
    () => Object.fromEntries((macro ?? []).map((r) => [Number(r.year), r])),
    [macro],
  )
  const finByKey = useMemo(
    () => Object.fromEntries((financials ?? []).map((r) => [`${r.stock_id}_${r.year}`, r])),
    [financials],
  )
  const stockId = sel || stocks[0]?.id || ''

  const saveMacro = async (year, d) => {
    setBusy(true)
    const r = await actions.upsertMacro({
      year,
      summary: d.summary,
      kospi: Math.round(Number(d.kospi)),
      sp500: Math.round(Number(d.sp500)),
      nikkei: Math.round(Number(d.nikkei)),
      europe: Math.round(Number(d.europe)),
      rate: Number(d.rate),
      cpi: Number(d.cpi),
      oil: Math.round(Number(d.oil)),
      gold: Math.round(Number(d.gold)),
    })
    setBusy(false)
    if (!r.ok) return notify(errorText(r.error), 'down')
    notify(`${year}년 시황 저장했어요`, 'gold')
    await refresh()
  }

  const saveFin = async (sid, year, d) => {
    setBusy(true)
    const payload = { stockId: sid, year }
    for (const m of FIN_INPUTS) payload[m.key] = Math.round(Number(d[m.key]) || 0)
    const r = await actions.upsertFinancial(payload)
    setBusy(false)
    if (!r.ok) return notify(errorText(r.error), 'down')
    notify(`${year}년 재무 저장했어요`, 'gold')
    await refresh()
  }

  const delFin = async (sid, year) => {
    setBusy(true)
    const r = await actions.deleteFinancial(sid, year)
    setBusy(false)
    if (!r.ok) return notify(errorText(r.error), 'down')
    notify(`${year}년 재무를 비웠어요`, 'gold')
    await refresh()
  }

  if (!game) return null

  return (
    <div className="apanel">
      <p className="anote">
        재무제표·시황은 DB에 있어요. 여기서 고치면 <b>재배포 없이</b> 학생 화면에 바로 반영됩니다.
        데이터셋 전체 저장·전환은 <b>[데이터셋]</b> 탭에서.
      </p>

      {/* ── 시황 */}
      <section className="acard">
        <span className="acap">시황 (거시경제) · 연도별</span>
        <div className="content-table">
          <div className="content-head macro">
            <span className="cr-year">연도</span>
            {MACRO_METRICS.map((m) => (
              <span key={m.key} className="cr-num">
                {m.label}
              </span>
            ))}
            <span className="sm-sp" />
          </div>
          {years.map((y) => (
            <MacroRow key={y} year={y} row={macroByYear[y]} onSave={saveMacro} busy={busy} />
          ))}
        </div>
      </section>

      {/* ── 재무제표 */}
      <section className="acard">
        <span className="acap">재무제표 · 종목별</span>
        <div className="fin-pick">
          <label>
            종목{' '}
            <select value={stockId} onChange={(e) => setSel(e.target.value)}>
              {stocks.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.id})
                </option>
              ))}
            </select>
          </label>
          <span className="anote">입력은 잎 7개(억원)만 — 자산·부채·자본·영업이익·당기순이익·부채비율·ROE는 자동 계산됩니다.</span>
        </div>
        <div className="content-table">
          <div className="content-head fin">
            <span className="cr-year">연도</span>
            {FIN_INPUTS.map((m) => (
              <span key={m.key} className="cr-num">
                {m.label}
              </span>
            ))}
            <span className="cr-calc">자동 계산</span>
            <span className="sm-sp" />
          </div>
          {years.map((y) => (
            <FinRow
              key={`${stockId}_${y}`}
              stockId={stockId}
              year={y}
              row={finByKey[`${stockId}_${y}`]}
              onSave={saveFin}
              onDelete={delFin}
              busy={busy}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
