import { useEffect, useState } from 'react'
import Modal from '../components/Modal'
import { errorText } from '../supabase'
import { simulateNextRound } from './priceSim'
import { PRESETS, deriveSectorBetas } from './simulatorPresets'
import { generateMacroNews } from './macroNews'

const QUICK_SEED = 42 // 빠른 경로는 재현성 우선 — 매번 같은 시드로 고정(난수 셔플 없음)

function fmtRemain(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

/**
 * 우측 상시 플로팅 진행 패널. Admin.jsx에 탭 전환과 무관하게 한 번만 마운트돼 있어서,
 * 어느 탭에 있든 라운드 상태를 보고, 다음 라운드로 넘기거나, 프리셋으로 즉시 다음 라운드
 * 가격을 생성·적용·속보 발행까지 할 수 있다(탭을 벗어나지 않고).
 *
 * 슬라이더까지 통째로 넣진 않았다 — 3개 프리셋 버튼 + 결과 요약 정도의 "빠른 길"만 두고,
 * 세밀하게 조정하고 싶으면 [주가 생성기 열기]로 이미 완성된 전체 탭(슬라이더·차트·AI 속보)으로
 * 보낸다. 둘 다 같은 sessionStorage 시나리오(PRESETS)를 공유해 결과가 서로 어긋나지 않는다.
 */
export default function FloatingRoundDock({ game, stocks, actions, notify, refresh, onNavigate }) {
  const [open, setOpen] = useState(false)
  const [confirmAdvance, setConfirmAdvance] = useState(false)
  const [busy, setBusy] = useState(false)
  const [nowTs, setNowTs] = useState(() => Date.now())

  const [quickPreview, setQuickPreview] = useState(null) // { applyPrices, headline, avgPct, count }
  const [confirmQuick, setConfirmQuick] = useState(false)
  const [quickBusy, setQuickBusy] = useState(false)

  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const round = game?.current_round ?? 0
  const total = game?.total_rounds ?? 0
  const ended = total > 0 && round > total

  const endsAt = game?.round_ends_at ? new Date(game.round_ends_at).getTime() : null
  const remainMs = endsAt ? Math.max(0, endsAt - nowTs) : 0
  const tradingOpen = round > 0 && !ended && !game?.is_locked && remainMs > 0

  const currentRoundYear = game?.round_year_map?.[String(round)] ?? null
  const nextRoundNumber = round + 1
  const nextRoundYear =
    game?.round_year_map?.[String(nextRoundNumber)] ?? (nextRoundNumber > total ? (game?.final_year ?? null) : null)
  const nextReady = round > 0 && round <= total && !!currentRoundYear && !!nextRoundYear && (stocks?.length ?? 0) > 0

  const advance = async () => {
    setBusy(true)
    const r = await actions.advanceRound()
    setBusy(false)
    setConfirmAdvance(false)
    if (!r.ok) return notify(errorText(r.error), 'down')
    notify(`R${r.current_round ?? round + 1}(으)로 넘어갔어요`, 'gold')
    await refresh()
  }

  const restartTimer = async () => {
    setBusy(true)
    const r = await actions.startTimer()
    setBusy(false)
    if (!r.ok) return notify(errorText(r.error), 'down')
    notify('타이머를 다시 시작했어요', 'gold')
    await refresh()
  }

  const quickGenerate = (preset) => {
    if (!nextReady) return
    const stockIds = stocks.map((s) => s.id)
    const macro = { unemp: preset.unemp, gdp: preset.gdp, int_r: preset.int_r, inf: preset.inf, sent: preset.sent, fx: preset.fx, oil: preset.oil }
    const { betaFx, betaOil } = deriveSectorBetas(QUICK_SEED, stockIds.length)
    const currentPrices = Object.fromEntries(
      stocks.map((s) => [s.id, Number(s.prices?.[String(currentRoundYear)]) || 10000]),
    )
    try {
      const nextPrices = simulateNextRound({ stockIds, currentPrices, macro, seed: QUICK_SEED, betaFx, betaOil })
      // admin_apply_simulated_prices는 stocks.prices를 통째로 교체한다(병합 아님) — 새 연도 가격만
      // 보내면 과거 연도가 전부 날아가 지금 라운드가 보여줄 연도 가격까지 사라진다(전 종목이
      // 거래정지로 먹통이 되는 버그의 원인이었다). 기존 prices에 새 연도만 얹어서 보낸다.
      const applyPrices = Object.fromEntries(
        stockIds.map((id) => {
          const stock = stocks.find((s) => s.id === id)
          return [id, { ...stock?.prices, [String(nextRoundYear)]: nextPrices[id] }]
        }),
      )
      const avgPct =
        (stockIds.reduce((sum, id) => sum + (nextPrices[id] - currentPrices[id]) / currentPrices[id], 0) /
          stockIds.length) *
        100
      const [headlineItem] = generateMacroNews(macro, null, nextRoundNumber)
      setQuickPreview({ applyPrices, headline: headlineItem.headline, avgPct, count: stockIds.length, presetLabel: preset.label })
    } catch (e) {
      notify(e?.message ?? String(e), 'down')
    }
  }

  const quickApply = async () => {
    if (!quickPreview) return
    setQuickBusy(true)
    const backupName = `자동백업(빠른생성) R${round}·${new Date().toISOString().slice(0, 10)}`
    const backup = await actions.saveDataset(backupName, '플로팅 독 빠른 생성 적용 전 자동 백업')
    if (!backup.ok) {
      setQuickBusy(false)
      notify('자동 백업에 실패해 적용을 중단했어요: ' + errorText(backup.error), 'down')
      return
    }
    const applied = await actions.applySimulatedPrices(quickPreview.applyPrices)
    if (!applied.ok) {
      setQuickBusy(false)
      notify(`백업(${backupName})은 됐지만 가격 적용에 실패했어요: ` + errorText(applied.error), 'down')
      return
    }
    const sent = await actions.sendBroadcast(quickPreview.headline)
    setQuickBusy(false)
    setConfirmQuick(false)
    if (!sent.ok) notify('가격은 반영됐지만 속보 발행에 실패했어요: ' + errorText(sent.error), 'down')
    else notify(`R${nextRoundNumber} 빠른 생성 적용 완료`, 'gold')
    setQuickPreview(null)
    await refresh()
  }

  const roundLabel = ended ? '대회 종료' : round === 0 ? '시작 전 · 대기 중' : `Round ${round} / ${total || '?'}`

  return (
    <div className={'sim-dock' + (open ? ' open' : '')}>
      <button
        type="button"
        className="sim-dock-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? '빠른 진행 패널 닫기' : '빠른 진행 패널 열기'}
      >
        {open ? '✕' : `R${round}${total ? `/${total}` : ''}`}
      </button>

      {open && (
        <div className="sim-dock-panel">
          <div className="sim-dock-badge">
            {roundLabel}
            {tradingOpen && <div className="sim-dock-timer">⏱ {fmtRemain(remainMs)} 남음</div>}
          </div>

          <button type="button" className="text-btn" disabled={busy || ended} onClick={() => setConfirmAdvance(true)}>
            ▶ 다음 라운드 진행
          </button>
          <button type="button" className="text-btn" disabled={busy || ended || round === 0} onClick={restartTimer}>
            ⏱ 타이머 재시작
          </button>
          <button type="button" className="text-btn" onClick={() => onNavigate?.('simulator')}>
            🧮 주가 생성기 열기
          </button>

          <div className="sim-dock-divider" />

          <div className="sim-dock-badge">⚡ 빠른 주가 생성</div>
          {!nextReady && <p className="sim-dock-note">진행 중인 라운드가 없어요.</p>}
          {nextReady && (
            <div className="sim-dock-presets">
              {PRESETS.map((p) => (
                <button key={p.key} type="button" className="text-btn tiny" onClick={() => quickGenerate(p)}>
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {quickPreview && (
            <div className="sim-dock-result">
              <p className="sim-dock-note">
                {quickPreview.presetLabel} · 평균 {quickPreview.avgPct >= 0 ? '+' : ''}
                {quickPreview.avgPct.toFixed(1)}% ({quickPreview.count}종목)
              </p>
              <button type="button" className="text-btn tiny" disabled={quickBusy} onClick={() => setConfirmQuick(true)}>
                이 결과로 적용 + 속보
              </button>
            </div>
          )}
        </div>
      )}

      <Modal open={confirmAdvance} onClose={() => setConfirmAdvance(false)} title="다음 라운드로 진행">
        <div className="confirm">
          <p className="big">현재 라운드를 마감하고 다음 연도 가격을 공개합니다.</p>
          <p className="ask">순위가 바뀌고 거래는 다시 잠깁니다(타이머는 별도로 다시 시작해야 해요). 계속할까요?</p>
        </div>
        <div className="mfoot">
          <button className="cancel" onClick={() => setConfirmAdvance(false)}>
            취소
          </button>
          <button className="act-btn buy" disabled={busy} onClick={advance}>
            진행
          </button>
        </div>
      </Modal>

      <Modal open={confirmQuick} onClose={() => setConfirmQuick(false)} title="빠른 생성 결과 적용">
        <div className="confirm">
          <p className="big">
            R{nextRoundNumber} 가격을 반영하고 "{quickPreview?.headline}" 속보를 <b>전 조에</b> 즉시 발송합니다.
          </p>
          <p className="ask">적용 전 현재 상태를 데이터셋으로 자동 백업합니다. 계속할까요?</p>
        </div>
        <div className="mfoot">
          <button className="cancel" onClick={() => setConfirmQuick(false)}>
            취소
          </button>
          <button className="act-btn buy" disabled={quickBusy} onClick={quickApply}>
            적용 + 발행
          </button>
        </div>
      </Modal>
    </div>
  )
}
