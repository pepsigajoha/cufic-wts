import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { makeAdminActions } from '../actions'
import { subscribeSignals } from '../gameData'
import { select, errorText } from '../supabase'
import ThemeToggle from '../components/ThemeToggle'
import TimerPill from '../components/RoundTimer'
import Toasts, { useToasts } from '../components/Toast'
import AdminProgress from './AdminProgress'
import AdminHints from './AdminHints'
import AdminTeams from './AdminTeams'
import AdminStocks from './AdminStocks'
import AdminOptions from './AdminOptions'
import AdminAnalytics from './AdminAnalytics'
import AdminSimulator from './AdminSimulator'
import AdminContent from './AdminContent'
import AdminDatasets from './AdminDatasets'
import AdminBoard from './AdminBoard'
import FloatingRoundDock from './FloatingRoundDock'

// 탭을 두 그룹으로. 준비 그룹은 제작 흐름 순서(데이터셋이 시작점 → 가격 → 재무·시황 → 힌트 → 조).
const TAB_GROUPS = [
  {
    label: '대회 운영',
    tabs: [
      { key: 'progress', label: '진행' },
      { key: 'board', label: '리더보드' },
      { key: 'analytics', label: '통계' },
    ],
  },
  {
    label: '게임 준비',
    tabs: [
      { key: 'datasets', label: '데이터셋' },
      { key: 'stocks', label: '종목·가격' },
      { key: 'options', label: '파생·옵션' },
      { key: 'simulator', label: '주가 생성기' },
      { key: 'content', label: '재무·시황' },
      { key: 'hints', label: '힌트' },
      { key: 'teams', label: '조 관리' },
    ],
  },
]

// 탭 상단 한 줄 도움말
const TAB_HELP = {
  progress: '대회 진행 — 라운드 넘기기·타이머·속보',
  board: '조별 순위 — 프로젝터용 큰 글씨 모드',
  analytics: '회전율·집중도로 본 투자성향과 배지 — 언제든 다시 집계 가능',
  datasets: '게임 데이터 한 벌의 저장·불러오기. 제작의 시작과 끝',
  stocks: '종목과 연도별 가격 — 게임의 뼈대',
  options: '풋·콜 옵션 계약 등록 — 학생은 파생·헷지 탭에서 매수만 할 수 있어요',
  simulator: '확률과정 엔진으로 라운드별 가격을 생성 — 미리보기 후에만 반영',
  content: '종목별 재무제표와 연도별 거시 지표',
  hints: '라운드별 힌트 작성과 지급',
  teams: '참가 조 — 입장 현황·게임 PIN·이름',
}

const SECRET_KEY = 'wts-admin' // 세션 동안만 기억한다 (sessionStorage)

export default function Admin({ theme, onToggleTheme }) {
  const [secret, setSecret] = useState(() => {
    try {
      return sessionStorage.getItem(SECRET_KEY) || ''
    } catch {
      return ''
    }
  })
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(true)
  const [tab, setTab] = useState('progress')
  const [dirty, setDirty] = useState(false) // 콘텐츠 편집 후 데이터셋에 저장 안 함
  const [nowTs, setNowTs] = useState(() => Date.now()) // 헤더 타이머 카운트다운용 1초 틱
  const [toasts, pushToast, dismissToast] = useToasts()

  const [game, setGame] = useState(null)
  const [stocks, setStocks] = useState([])
  const [teams, setTeams] = useState([])
  const [gamePin, setGamePin] = useState(null) // 공용 게임 PIN (자율 입장). admin_teams_status가 반환
  const [hints, setHints] = useState([])
  const [board, setBoard] = useState([])
  const [broadcasts, setBroadcasts] = useState([])
  const [financials, setFinancials] = useState([]) // 재무제표 행 (편집용)
  const [macro, setMacro] = useState([]) // 시황 행 (편집용)
  const [optionsContracts, setOptionsContracts] = useState([]) // 옵션 계약 (활성·비활성 전부 — 관리자는 다 봄)
  const [analytics, setAnalytics] = useState([]) // 팀별 행동 텔레메트리 집계 결과

  // 비밀은 ref로 읽는다 — 로그인 직후 refresh()가 옛 secret 클로저를 쓰지 않게(안 그러면
  // 관리자 RPC가 빈 비밀번호로 호출돼 조·힌트·재무·시황이 로그인 직후 전부 비어 버린다).
  const secretRef = useRef(secret)
  secretRef.current = secret
  const actions = useMemo(() => makeAdminActions(() => secretRef.current), [])

  const refresh = useCallback(async () => {
    const [g, s, ts, hs, , bc, fin, mac, opt, an] = await Promise.all([
      select('game_state', '*'),
      select('stocks', '*'),
      actions.teamsStatus(),
      actions.listHints(),
      select('public_teams', '*'), // 리더보드는 RPC로 따로
      select('broadcasts', '*', (q) => q.order('id', { ascending: false })),
      actions.listFinancials(), // 편집용: 미래 연도까지 전부
      actions.listMacro(),
      select('options_contracts', '*'), // 관리자는 비활성 계약도 본다(학생은 active만)
      select('game_team_analytics', '*'),
    ])
    if (g.ok) setGame(g.rows[0] ?? null)
    if (s.ok) setStocks(s.rows.slice().sort((a, b) => a.display_order - b.display_order))
    if (ts.ok) {
      setTeams(ts.teams ?? [])
      setGamePin(ts.game_pin ?? null)
    }
    if (hs.ok) setHints(hs.hints ?? [])
    if (bc.ok) setBroadcasts(bc.rows ?? [])
    if (fin.ok) setFinancials(fin.rows ?? [])
    if (mac.ok) setMacro(mac.rows ?? [])
    if (opt.ok) setOptionsContracts(opt.rows ?? [])
    if (an.ok) setAnalytics(an.rows ?? [])
    const { rpc } = await import('../supabase')
    const b = await rpc('leaderboard')
    if (b.ok) setBoard(b.rows ?? [])
  }, [actions])

  // 저장된 비밀로 자동 로그인
  useEffect(() => {
    ;(async () => {
      if (!secret) {
        setChecking(false)
        return
      }
      const r = await actions.login(secret)
      if (r.ok) {
        setAuthed(true)
        await refresh()
      }
      setChecking(false)
    })()
    // secret이 바뀔 때만 (로그인 시)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 실시간: 다른 곳에서 바뀌면 갱신 + 콘텐츠 편집이면 dirty 표시
  useEffect(() => {
    if (!authed) return
    return subscribeSignals((sig) => {
      if (['content_changed', 'hints_changed', 'stocks_changed'].includes(sig?.kind)) setDirty(true)
      refresh()
    })
  }, [authed, refresh])

  // 헤더 타이머 1초 틱
  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const doLogin = async (e) => {
    e.preventDefault()
    const input = new FormData(e.target).get('secret')?.toString() ?? ''
    secretRef.current = input // 로그인·직후 refresh가 이 비밀을 쓰게(상태 반영 전이라 ref로)
    const r = await actions.login(input)
    if (!r.ok) {
      pushToast(errorText(r.error), 'down')
      return
    }
    setSecret(input)
    try {
      sessionStorage.setItem(SECRET_KEY, input)
    } catch {
      /* 무시 */
    }
    setAuthed(true)
    await refresh()
  }

  const logout = () => {
    try {
      sessionStorage.removeItem(SECRET_KEY)
    } catch {
      /* 무시 */
    }
    setSecret('')
    setAuthed(false)
  }

  if (checking) {
    return (
      <div className="boot">
        <div className="spinner" />
      </div>
    )
  }

  if (!authed) {
    return (
      <div className="login">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} className="theme-fab" />
        <div className="card">
          <span className="brand-logo" role="img" aria-label="CUFIC WTS" />
          <h1>관리자</h1>
          <p className="sub2">CUFIC WTS · 대회 운영</p>
          <form onSubmit={doLogin}>
            <div className="field">
              <label htmlFor="secret">관리자 비밀번호</label>
              <input id="secret" name="secret" type="password" autoFocus autoComplete="off" />
            </div>
            <button type="submit" className="go">
              들어가기
            </button>
          </form>
        </div>
        <Toasts toasts={toasts} onDismiss={dismissToast} />
      </div>
    )
  }

  const shared = {
    actions,
    game,
    stocks,
    teams,
    gamePin,
    hints,
    board,
    broadcasts,
    financials,
    macro,
    optionsContracts,
    analytics,
    refresh,
    notify: pushToast,
    dirty,
    onSaved: () => setDirty(false),
  }

  // 헤더 거래 타이머 (A안 필) — 서버 round_ends_at 기준
  const tEndsAt = game?.round_ends_at ? new Date(game.round_ends_at).getTime() : null
  const tRemain = tEndsAt ? Math.max(0, tEndsAt - nowTs) : 0
  const tDur = (game?.round_duration_seconds ?? 600) * 1000
  const tState =
    (game?.current_round ?? 0) > 0 && !game?.is_ended
      ? tRemain > 0 && !game?.is_locked
        ? 'live'
        : tEndsAt
          ? 'closed'
          : 'waiting'
      : null

  return (
    <div className="admin">
      <header>
        <div className="logo">
          <span className="brand-logo" role="img" aria-label="CUFIC WTS" />
        </div>
        <span className="badge round">관리자</span>
        {game && (
          <span className="badge muted">
            {game.current_round === 0
              ? '시작 전 · 대기 중'
              : `ROUND ${game.current_round} · ${game.round_year_map?.[String(game.current_round)]}년`}
          </span>
        )}
        {game?.is_locked && <span className="badge">정산 중</span>}
        {tState && <TimerPill remainingMs={tRemain} durationMs={tDur} state={tState} />}
        <div className="hbtns">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button className="text-btn" onClick={logout}>
            로그아웃
          </button>
        </div>
      </header>

      <div className="admin-body">
        <nav className="admin-tabs">
          {TAB_GROUPS.map((g) => (
            <div key={g.label} className="tab-group">
              <span className="tab-group-label">{g.label}</span>
              {g.tabs.map((t) => (
                <button
                  key={t.key}
                  className={tab === t.key ? 'on' : ''}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <main className="admin-main">
          {TAB_HELP[tab] && <p className="tab-help">{TAB_HELP[tab]}</p>}
          {tab === 'progress' && <AdminProgress {...shared} />}
          {tab === 'hints' && <AdminHints {...shared} />}
          {tab === 'teams' && <AdminTeams {...shared} />}
          {tab === 'stocks' && <AdminStocks {...shared} />}
          {tab === 'options' && <AdminOptions {...shared} />}
          {tab === 'analytics' && <AdminAnalytics {...shared} />}
          {tab === 'simulator' && <AdminSimulator {...shared} />}
          {tab === 'content' && <AdminContent {...shared} />}
          {tab === 'datasets' && <AdminDatasets {...shared} />}
          {tab === 'board' && <AdminBoard {...shared} />}
        </main>
      </div>

      <FloatingRoundDock
        game={game}
        stocks={stocks}
        actions={actions}
        notify={pushToast}
        refresh={refresh}
        onNavigate={setTab}
      />
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
