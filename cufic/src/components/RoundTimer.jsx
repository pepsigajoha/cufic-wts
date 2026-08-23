// 거래 라운드 타이머 — A안(헤더 필: 라벨+시간 위, 아래 얇은 진행바). 학생·관리자 공용.
//   · state: 'live'(카운트다운) | 'closed'(마감) | 'waiting'(대기)
//   · 색: 여유=골드 / 남은 60초↓=경고(--warn) / 30초↓=긴급(--up, 점 깜빡임 + 테두리 발광)
//   · 진행바 기준값 durationMs = round_duration_seconds(라운드 시작 시 설정된 총 시간)
//   · 서버 round_ends_at이 유일 기준. 클라 카운트다운은 UX용.

const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// 남은 시간 단계 → 상태 클래스 (live일 때만)
function tier(state, remainingMs) {
  if (state !== 'live') return ''
  if (remainingMs <= 30000) return ' urgent'
  if (remainingMs <= 60000) return ' warn'
  return '' // 여유(기본=골드)
}
const fillPct = (remainingMs, durationMs, live) =>
  live && durationMs > 0 ? Math.max(0, Math.min(100, (remainingMs / durationMs) * 100)) : 0

// A안 — 헤더/카드용 필 (라벨+시간 위, 아래 얇은 진행바)
export default function TimerPill({ remainingMs = 0, durationMs = 0, state = 'waiting' }) {
  const live = state === 'live'
  return (
    <span className={'timer-pill' + (live ? ' live' : '') + tier(state, remainingMs)} role="timer">
      <span className="tp-top">
        <span className="tp-dot" />
        <span className="tp-label">거래</span>
        <span className="tp-time num">
          {state === 'live' ? mmss(remainingMs) : state === 'closed' ? '마감' : '대기'}
        </span>
      </span>
      <span className="tp-bar">
        <i style={{ width: fillPct(remainingMs, durationMs, live) + '%' }} />
      </span>
    </span>
  )
}
