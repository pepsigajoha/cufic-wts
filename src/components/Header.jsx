import { useEffect, useRef, useState } from 'react'
import { num, pct, arrowOf, dirOf } from '../format'
import ThemeToggle from './ThemeToggle'
import TimerPill from './RoundTimer'

// 값이 바뀔 때 잠깐 방향색으로 번쩍였다가 원래대로 — 평가금액처럼 "지켜보는 숫자"에.
// 실제로 값이 달라졌을 때만, 한 번만 발동한다(라운드 넘어갈 때 등).
function useValueFlash(value) {
  const prev = useRef(value)
  const [flash, setFlash] = useState('')
  useEffect(() => {
    if (prev.current === value || !Number.isFinite(value) || !Number.isFinite(prev.current)) {
      prev.current = value
      return
    }
    setFlash(value > prev.current ? 'flash-up' : 'flash-down')
    prev.current = value
    const t = setTimeout(() => setFlash(''), 700)
    return () => clearTimeout(t)
  }, [value])
  return flash
}

/**
 * 상단 바 — 정보 위계 3그룹.
 *   1차(hdr-primary)   : 현재 라운드 · 거래 타이머 · 평가금액 — 지금 상황을 좌우하는 정보. 절대 줄지 않는다.
 *   2차(hdr-secondary) : 팀 · 주문가능 · 순위 · 힌트 · 속보 — 보조 정보. 공간이 좁으면 먼저 줄어든다.
 *   유틸(hbtns)        : 테마 · 로그아웃.
 */
export default function Header({
  account,
  team,
  round,
  ended = false,
  rank,
  teamCount,
  hintCount = 0,
  remainingMs = 0,
  durationMs = 0,
  timerState = null, // 'live' | 'paused' | 'closed' | 'waiting' | null(숨김)
  quarter = null, // { n: 1..4, month: 1..12 } — 거래 중일 때만. null이면 숨김
  bellTotal = 0,
  bellCount = 0,
  onOpenBroadcasts,
  onOpenRanking,
  onOpenHints,
  theme,
  onToggleTheme,
  onLogout,
}) {
  const dir = dirOf(account.pnl)
  const eqFlash = useValueFlash(account.equity)
  const roundText = ended ? '🏁 최종' : round.round === 0 ? '시작 전' : `ROUND ${round.round}`
  const roundSub = ended || round.round >= 1 ? `${round.year}년` : '대기 중'

  return (
    <header>
      <div className="logo">
        <span className="brand-logo" role="img" aria-label="CUFIC WTS" />
      </div>

      {/* ── 1차: 지금 상황을 좌우하는 정보 ── */}
      <div className="hdr-primary">
        <span className="hp-round">
          {roundText}
          <em>{roundSub}</em>
        </span>

        {timerState && (
          <TimerPill remainingMs={remainingMs} durationMs={durationMs} state={timerState} />
        )}

        {quarter && (
          <span className="hp-quarter" aria-label={`${quarter.n}분기 ${quarter.month}월`}>
            Q{quarter.n}·{quarter.month}월
          </span>
        )}

        <span className="hp-equity">
          <span className="hpe-k">평가금액</span>
          <span className={'hpe-v num ' + eqFlash}>₩ {num(account.equity)}</span>
          <span className={'hpe-p num ' + dir}>
            {arrowOf(account.pnl)} {pct(account.pnlPct)}
          </span>
        </span>
      </div>

      {/* ── 2차: 보조 정보 ── */}
      <div className="hdr-secondary">
        <span className="hs-team" title={team}>
          {team}
        </span>

        <span className="hs-cash num">주문가능 ₩ {num(account.cash)}</span>

        {rank != null && (
          <button
            className="hs-btn"
            onClick={onOpenRanking}
            aria-haspopup="dialog"
            aria-label={`전체 순위 보기 — 현재 ${rank}위 / ${teamCount}조`}
          >
            순위 <b className="num">{rank}</b>
            <em className="num">/{teamCount}</em>
          </button>
        )}

        <button
          className="hs-btn"
          onClick={onOpenHints}
          aria-haspopup="dialog"
          aria-label={`내 힌트 보기 — ${hintCount}개`}
        >
          힌트{hintCount > 0 && <b className="num">{hintCount}</b>}
        </button>

        {bellTotal > 0 && (
          <button
            className={'hs-btn bell' + (bellCount > 0 ? ' ring' : '')}
            onClick={onOpenBroadcasts}
            aria-haspopup="dialog"
            aria-label={bellCount > 0 ? `속보 보기 — 새 속보 ${bellCount}건` : '속보 보기'}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path
                d="M12 2.4a5.2 5.2 0 0 0-5.2 5.2v2.9L5.3 13.4a1 1 0 0 0 .9 1.5h11.6a1 1 0 0 0 .9-1.5l-1.5-2.9V7.6A5.2 5.2 0 0 0 12 2.4Z"
                fill="currentColor"
              />
              <path d="M9.7 18a2.3 2.3 0 0 0 4.6 0Z" fill="currentColor" />
            </svg>
            {bellCount > 0 && <b className="num">{bellCount}</b>}
          </button>
        )}
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
