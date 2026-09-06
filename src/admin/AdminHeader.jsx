import { useEffect, useState } from 'react'
import ThemeToggle from '../components/ThemeToggle'
import TimerPill from '../components/RoundTimer'

/**
 * 관리자 상단 고정 바 — 지금 게임이 어떤 상태인지 한 줄로. 조작 버튼은 두지 않는다
 * (빠른 조작은 우측 FloatingRoundDock, 세부는 각 탭).
 *   브랜드 | 게임 상태(라운드·타이머·거래) | 메타(입장 조·연결) | 유틸(테마·로그아웃)
 *
 * @param connected  실시간(웹소켓) 연결됨 여부. null이면 "연결 중".
 */
export default function AdminHeader({ theme, onToggleTheme, game, teams = [], connected, onLogout }) {
  const [nowTs, setNowTs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const round = game?.current_round ?? 0
  const total = game?.total_rounds ?? 0
  const ended = !!game?.is_ended || (total > 0 && round > total)

  // round_ends_at이 없거나 파싱 불가(NaN)면 타이머를 그리지 않는다 — NaN이 TimerPill로 새지 않게.
  const parsedEndsAt = game?.round_ends_at ? new Date(game.round_ends_at).getTime() : NaN
  const endsAt = Number.isFinite(parsedEndsAt) ? parsedEndsAt : null
  const remainMs = endsAt ? Math.max(0, endsAt - nowTs) : 0
  const rawDurSec = Number(game?.round_duration_seconds)
  const durMs = (Number.isFinite(rawDurSec) && rawDurSec > 0 ? rawDurSec : 600) * 1000
  const timerState =
    round > 0 && !ended
      ? remainMs > 0 && !game?.is_locked
        ? 'live'
        : endsAt
          ? 'closed'
          : 'waiting'
      : null

  const roundText = ended
    ? '🏁 대회 종료'
    : round === 0
      ? '시작 전 · 대기 중'
      : `ROUND ${round}${total ? ` / ${total}` : ''} · ${game?.round_year_map?.[String(round)] ?? '—'}년`

  const tradeText = { live: '거래 열림', closed: '거래 마감', waiting: '타이머 대기' }[timerState]
  const connLabel = connected == null ? '연결 중' : connected ? '실시간' : '끊김'

  return (
    <header className="admin-head">
      <div className="ah-brand">
        <span className="brand-logo" role="img" aria-label="CUFIC WTS" />
        <span className="ah-tag">관리자</span>
      </div>

      <div className="ah-status">
        <span className={'ah-round' + (ended ? ' ended' : round === 0 ? ' idle' : '')}>
          {roundText}
        </span>
        {game?.is_locked && <span className="ah-chip amber">정산 중</span>}
        {timerState && <TimerPill remainingMs={remainMs} durationMs={durMs} state={timerState} />}
        {tradeText && <span className={'ah-chip trade-' + timerState}>{tradeText}</span>}
      </div>

      <div className="ah-meta">
        <span className="ah-teams">
          입장 <b>{teams.length}</b>조
        </span>
        <span
          className={'conn-dot ' + (connected == null ? 'wait' : connected ? 'ok' : 'bad')}
          title={connected == null ? '실시간 연결 중…' : connected ? '실시간 연결됨' : '실시간 연결 끊김'}
        >
          ● {connLabel}
        </span>
      </div>

      <div className="hbtns">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <button className="text-btn" onClick={onLogout}>
          로그아웃
        </button>
      </div>
    </header>
  )
}
