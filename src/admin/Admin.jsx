import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { makeAdminActions } from '../actions'
import { subscribeSignals } from '../gameData'
import { select, rpc, errorText } from '../supabase'
import ThemeToggle from '../components/ThemeToggle'
import Toasts, { useToasts } from '../components/Toast'
import AdminHeader from './AdminHeader'
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
import AdminSystem from './AdminSystem'
import FloatingRoundDock from './FloatingRoundDock'

// 관리자는 두 가지 일을 한다: 대회 전 콘텐츠 만들기(준비) / 대회 중 프로젝터 앞에서 굴리기(운영).
// 내비도 그 둘로 나눈다 — 운영 진입점 2개는 라벨 없이 크게, 나머지는 그룹으로.
const TAB_GROUPS = [
  {
    label: null, // 운영 진입점 — 크게, 상단에
    tabs: [
      { key: 'progress', label: '운영 콘솔' },
      { key: 'board', label: '리더보드' },
    ],
  },
  {
    label: '준비',
    tabs: [
      { key: 'datasets', label: '데이터셋' },
      { key: 'stocks', label: '종목·가격' },
      { key: 'content', label: '재무·시황' },
      { key: 'hints', label: '힌트' },
      { key: 'options', label: '파생·옵션' },
      { key: 'simulator', label: '주가 생성기' },
      { key: 'teams', label: '조 관리' },
    ],
  },
  {
    label: '검토·설정',
    tabs: [
      { key: 'analytics', label: '통계' },
      { key: 'system', label: '시스템' },
    ],
  },
]

// 탭 상단 한 줄 도움말
const TAB_HELP = {
  progress: '운영 콘솔 — 대회를 굴리는 곳. 라운드 넘기기·타이머·속보 (빠른 조작은 우측 하단 진행 패널)',
  board: '조별 순위 — 프로젝터용 큰 글씨 모드',
  analytics: '회전율·집중도로 본 투자성향과 배지 — 언제든 다시 집계 가능',
  datasets: '게임 데이터 한 벌의 저장·불러오기. 제작의 시작과 끝',
  stocks: '종목과 연도별 가격 — 게임의 뼈대',
  options: '풋·콜 옵션 계약 등록 — 학생은 파생·헷지 탭에서 매수만 할 수 있어요',
  simulator: '확률과정 엔진으로 라운드별 가격을 생성 — 미리보기 후에만 반영',
  content: '종목별 재무제표와 연도별 거시 지표',
  hints: '라운드별 힌트 작성과 지급',
  teams: '참가 조 — 입장 현황·게임 PIN·이름',
  system: '게임 설정 · 데이터 점검 · 게임 리셋 — 되돌리기 어려운 작업',
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
  const [connected, setConnected] = useState(null) // 실시간 채널 연결 상태 (null=연결 중)
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
  const [pathSources, setPathSources] = useState({}) // { [year]: { bridge, engine, total } }

  // 비밀은 ref로 읽는다 — 로그인 직후 refresh()가 옛 secret 클로저를 쓰지 않게(안 그러면
  // 관리자 RPC가 빈 비밀번호로 호출돼 조·힌트·재무·시황이 로그인 직후 전부 비어 버린다).
  const secretRef = useRef(secret)
  secretRef.current = secret
  const actions = useMemo(() => makeAdminActions(() => secretRef.current), [])

  // 실시간 신호가 몰아치면 refresh()가 겹쳐 돈다 — 느린 이전 응답이 빠른 최신 응답을
  // 덮어써 화면이 과거 상태로 되돌아갈 수 있다. 매 호출에 번호를 매겨 최신 것만 반영한다.
  const refreshSeq = useRef(0)
  const refresh = useCallback(async () => {
    const myTurn = ++refreshSeq.current
    let res
    try {
      res = await Promise.all([
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
        rpc('leaderboard'),
        select('stock_price_paths', 'year,source'), // 연도별 시세 출처(브리지/엔진) 뱃지용
      ])
    } catch (e) {
      // Promise.all의 각 래퍼는 던지지 않도록 설계됐지만, 예외 상황에서도 화면이 죽지 않게.
      console.error('[admin:refresh]', e)
      return
    }
    if (myTurn !== refreshSeq.current) return // 더 최신 refresh가 이미 떴다 — 이 결과는 버린다

    const [g, s, ts, hs, , bc, fin, mac, opt, an, lb, spp] = res
    if (g.ok) setGame(g.rows[0] ?? null)
    if (spp?.ok) {
      // { [year]: { bridge, engine, total } } — [진행] 탭 라운드별 시세 출처 뱃지
      const by = {}
      for (const r of spp.rows) {
        const y = Number(r.year)
        ;(by[y] ??= { bridge: 0, engine: 0, total: 0 })
        by[y][r.source] = (by[y][r.source] ?? 0) + 1
        by[y].total += 1
      }
      setPathSources(by)
    }
    if (s.ok)
      setStocks(s.rows.slice().sort((x, y) => (x.display_order ?? 0) - (y.display_order ?? 0)))
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
    if (lb.ok) setBoard(lb.rows ?? [])
  }, [actions])

  // 라운드 중엔 학생 체결이 signal을 쏘지 않아 위 refresh가 안 돈다 → 타이머가 열려 있는
  // 동안만 잔고·순위·거래통계를 가볍게(3쿼리) 폴링한다. 편집용 대용량(재무·시황·힌트)은 안 건드린다.
  // ponytail: 5초 고정 폴링. 부하가 보이면 간격을 늘리거나 place_order에 조용한 signal을 추가한다.
  const liveSeq = useRef(0)
  const refreshLive = useCallback(async () => {
    const myTurn = ++liveSeq.current
    let res
    try {
      res = await Promise.all([select('game_state', '*'), actions.teamsStatus(), rpc('leaderboard')])
    } catch (e) {
      console.error('[admin:refreshLive]', e)
      return
    }
    if (myTurn !== liveSeq.current) return
    const [g, ts, lb] = res
    if (g.ok) setGame(g.rows[0] ?? null)
    if (ts.ok) {
      setTeams(ts.teams ?? [])
      setGamePin(ts.game_pin ?? null)
    }
    if (lb.ok) setBoard(lb.rows ?? [])
  }, [actions])

  const roundEndsAt = game?.round_ends_at ? new Date(game.round_ends_at).getTime() : 0
  const [liveOn, setLiveOn] = useState(false)
  useEffect(() => {
    if (!authed || !roundEndsAt || Date.now() >= roundEndsAt) {
      setLiveOn(false)
      return
    }
    setLiveOn(true)
    const id = setInterval(() => {
      if (Date.now() >= roundEndsAt) {
        clearInterval(id)
        setLiveOn(false)
        return
      }
      void refreshLive()
    }, 5000)
    return () => clearInterval(id)
  }, [authed, roundEndsAt, refreshLive])

  // 저장된 비밀로 자동 로그인
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        if (!secret) return
        const r = await actions.login(secret)
        if (alive && r.ok) {
          setAuthed(true)
          await refresh()
        }
      } catch (e) {
        console.error('[admin:auto-login]', e)
      } finally {
        if (alive) setChecking(false)
      }
    })()
    return () => {
      alive = false
    }
    // secret이 바뀔 때만 (로그인 시)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 실시간: 다른 곳에서 바뀌면 갱신 + 콘텐츠 편집이면 dirty 표시 + 연결 상태를 헤더에 노출
  useEffect(() => {
    if (!authed) return
    return subscribeSignals(
      (sig) => {
        if (['content_changed', 'hints_changed', 'stocks_changed'].includes(sig?.kind)) setDirty(true)
        void refresh()
      },
      (ok, reconnected) => {
        setConnected(ok)
        // 끊겼다 다시 붙었으면 그 사이 놓친 변경을 한 번 강제로 따라잡는다.
        if (reconnected) void refresh()
      },
    )
  }, [authed, refresh])

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
    pathSources,
    liveOn,
    refresh,
    refreshLive,
    notify: pushToast,
    dirty,
    onSaved: () => setDirty(false),
  }

  return (
    <div className="admin">
      <AdminHeader
        theme={theme}
        onToggleTheme={onToggleTheme}
        game={game}
        teams={teams}
        connected={connected}
        onLogout={logout}
      />

      <div className="admin-body">
        <nav className="admin-tabs">
          {TAB_GROUPS.map((g) => (
            <div
              key={g.label ?? 'primary'}
              className={'tab-group' + (g.label ? '' : ' tab-group--primary')}
            >
              {g.label && <span className="tab-group-label">{g.label}</span>}
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
          {tab === 'system' && <AdminSystem {...shared} />}
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
