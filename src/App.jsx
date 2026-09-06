import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { deriveAccount } from './account'
import { makeActions } from './actions'
import { buildStocks, execPriceOf, loadAll, refetchMine, subscribeSignals, yearOf } from './gameData'
import { roundStepIndex } from './chart'
import { useTheme } from './theme'
import {
  loadTeam,
  login as authLogin,
  join as authJoin,
  getJoinMode,
  logout as authLogout,
  restore,
} from './auth'
import { errorText } from './supabase'

import Login from './components/Login'
import RotateNotice from './components/RotateNotice'
import Header from './components/Header'
import StockList from './components/StockList'
import Chart from './components/Chart'
import OrderSheet from './components/OrderSheet'
import ModeTabs from './components/ModeTabs'
import PayoffDiagram from './components/PayoffDiagram'
import OptionOrderPanel from './components/OptionOrderPanel'
import HintModal from './components/HintModal'
import BroadcastModal from './components/BroadcastModal'
import EmergencyBroadcast from './components/EmergencyBroadcast'
import MarketModal from './components/MarketModal'
import MyModal from './components/MyModal'
import FinancialModal from './components/FinancialModal'
import RoundModal from './components/RoundModal'
import FinalModal from './components/FinalModal'
import RankingModal from './components/RankingModal'
import Toasts, { useToasts } from './components/Toast'
import Admin from './admin/Admin'

export default function App() {
  const [theme, toggleTheme] = useTheme()

  // /admin 또는 ?admin=1 로 관리자 화면. 라우터를 들이지 않고 최소로 분기한다.
  const isAdmin =
    typeof window !== 'undefined' &&
    (window.location.pathname.startsWith('/admin') ||
      new URLSearchParams(window.location.search).has('admin'))

  if (isAdmin) return <Admin theme={theme} onToggleTheme={toggleTheme} />

  return <Student theme={theme} onToggleTheme={toggleTheme} />
}

function Student({ theme, onToggleTheme }) {
  const [team, setTeam] = useState(null)
  const [booting, setBooting] = useState(true) // 저장된 코드로 재로그인 시도 중
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [joinMode, setJoinMode] = useState('code') // 'code' | 'open' (로그인 전 화면 분기)

  const [game, setGame] = useState(null)
  const [rawStocks, setRawStocks] = useState([])
  const [pricePaths, setPricePaths] = useState([]) // stock_price_paths 행 — 장중 252일 경로
  const [positions, setPositions] = useState([])
  const [cash, setCash] = useState(0)
  const [trades, setTrades] = useState([])
  const [hints, setHints] = useState([])
  const [snapshots, setSnapshots] = useState([])
  const [board, setBoard] = useState([])
  const [broadcasts, setBroadcasts] = useState([]) // 전체 공통 속보
  const [alertBc, setAlertBc] = useState(null) // 새로 도착한 속보 → 재난문자 팝업
  const [marketOpen, setMarketOpen] = useState(false) // 시황판(거시경제)
  const [financials, setFinancials] = useState({}) // 재무제표 (DB)
  const [macro, setMacro] = useState({}) // 시황 (DB)
  const [seed, setSeed] = useState(0) // 내 조의 원금. 조마다 다를 수 있다.

  const [placing, setPlacing] = useState(false) // 즉시 체결 요청 중
  const [nowTs, setNowTs] = useState(() => Date.now()) // 카운트다운용 1초 틱
  const [selectedCode, setSelectedCode] = useState(null)
  const [drawings, setDrawings] = useState({})

  // 파생·헷지 — 주식 매매(spot)와 화면을 전환한다. 서버 데이터가 아니라 순수 화면 상태다.
  const [mode, setMode] = useState('spot') // 'spot' | 'hedge'
  const [optionsContracts, setOptionsContracts] = useState([])
  const [myOptionPositions, setMyOptionPositions] = useState([])
  // OptionOrderPanel(오른쪽)이 지금 보고 있는 계약·프리미엄·수량을 PayoffDiagram(가운데)에 전달.
  const [hedgeQuote, setHedgeQuote] = useState({ contract: null, premiumPerUnit: 0, qty: 0 })

  const [myOpen, setMyOpen] = useState(false)
  const [finOpen, setFinOpen] = useState(false)
  const [rankOpen, setRankOpen] = useState(false)
  const [hintsOpen, setHintsOpen] = useState(false)
  const [bcOpen, setBcOpen] = useState(false) // 속보 팝업
  // 마지막으로 확인한 속보 id — 이보다 큰 게 있으면 종이 깜빡인다 (기기별 localStorage)
  const [seenBc, setSeenBc] = useState(() => {
    try {
      return Number(localStorage.getItem('wts-seen-bc') || 0)
    } catch {
      return 0
    }
  })
  const [roundSummary, setRoundSummary] = useState(null)
  const [finalOpen, setFinalOpen] = useState(false) // 대회 종료 결과 모달
  const [bankruptSeen, setBankruptSeen] = useState(false) // 파산 배너 — 이 라운드에 이 기기에서 닫았는지
  const [toasts, pushToast, dismissToast] = useToasts()

  const stocks = useMemo(
    () => buildStocks(rawStocks, game, positions, pricePaths),
    [rawStocks, game, positions, pricePaths],
  )
  const selected = useMemo(() => {
    const found = stocks.find((s) => s.code === selectedCode)
    if (found && !found.preListed) return found
    // 상장 예정 종목은 목록에 없으니, 선택도 상장된 종목으로 넘어간다
    return stocks.find((s) => !s.preListed) ?? stocks[0] ?? null
  }, [stocks, selectedCode])
  // 지금 라운드 진행률 → 스텝(0..251). 선택 종목의 "장중 현재가"(주문 예상금액·토스트용).
  const liveStep = roundStepIndex(game, nowTs)
  const selExecPrice = selected ? execPriceOf(selected, liveStep) : 0
  const acct = useMemo(() => deriveAccount(stocks, cash, seed || 0), [stocks, cash, seed])

  // 순위 행 (헤더 배지 · 순위 모달이 공유)
  const rankRows = useMemo(
    () =>
      board.map((b) => ({
        rank: Number(b.rank),
        prevRank: b.prev_rank != null ? Number(b.prev_rank) : null,
        name: b.name,
        equity: Number(b.equity),
        pnl: Number(b.pnl),
        pnlPct: Number(b.pnl_pct),
        me: b.team_id === team?.id,
      })),
    [board, team],
  )
  const realizedTotal = useMemo(
    () => trades.reduce((s, t) => s + Number(t.realized_pnl ?? 0), 0),
    [trades],
  )
  const year = yearOf(game)
  const locked = !!game?.is_locked
  const started = (game?.current_round ?? 0) >= 1
  const ended = !!game?.is_ended // 최종 정산 완료 (final_year 공개)

  // 라운드 타이머. 서버 round_ends_at이 유일한 기준이다(place_order도 서버 시각으로 검사).
  // 클라이언트 시계가 어긋나도 표시만 틀릴 뿐, 마감 이후 거래는 서버가 거부한다.
  const endsAt = game?.round_ends_at ? new Date(game.round_ends_at).getTime() : null
  const remainingMs = endsAt ? Math.max(0, endsAt - nowTs) : 0
  const durationMs = (game?.round_duration_seconds ?? 600) * 1000
  const tradingOpen = started && !locked && remainingMs > 0
  // 타이머 표시 상태: live(카운트다운) / closed(마감) / waiting(대기) / null(숨김)
  const timerState = started && !ended ? (tradingOpen ? 'live' : endsAt ? 'closed' : 'waiting') : null

  // 안 읽은 속보 개수 — 종 버튼 깜빡임·배지용
  const unreadBc = broadcasts.reduce((n, b) => n + (Number(b.id) > seenBc ? 1 : 0), 0)

  const myRow = board.find((b) => b.team_id === team?.id)
  const myRank = myRow?.rank ?? null
  // 자산이 원금의 20% 이하로 쪼그라들면 파산 위기 안내
  const bankrupt = started && !ended && seed > 0 && acct.equity <= seed * 0.2

  // 수익률 차트 — 서버 스냅샷 기반
  const rounds = useMemo(() => {
    const total = game?.total_rounds ?? 0
    const pts = [{ label: '시작', equity: seed || 0 }]
    for (const s of snapshots) {
      // total_rounds를 넘는 스냅샷 = 최종 정산(final_year)
      const lbl =
        s.round > total
          ? `최종 · ${game?.final_year ?? ''}`
          : `R${s.round} · ${game?.round_year_map?.[String(s.round)] ?? ''}`
      pts.push({ label: lbl, equity: Number(s.equity) })
    }
    // 종료 상태면 마지막 스냅샷이 곧 현재값이라 '지금' 중복을 넣지 않는다
    if (started && !ended) pts.push({ label: `지금 · R${game.current_round}`, equity: acct.equity })
    return pts
  }, [snapshots, seed, acct.equity, game, started, ended])

  // ── 데이터 로드
  const teamRef = useRef(null)
  teamRef.current = team
  // 신호 콜백이 최신 힌트 목록을 봐야 한다 (클로저에 갇히면 안 됨)
  const hintsRef = useRef([])
  hintsRef.current = hints

  const load = useCallback(async (t) => {
    setLoading(true)
    setLoadError(null)
    const r = await loadAll(t.code, t.id)
    setLoading(false)
    if (!r.ok) {
      setLoadError(r.error)
      return false
    }
    setGame(r.game)
    setRawStocks(r.rawStocks)
    setPricePaths(r.pricePaths ?? [])
    setPositions(r.positions)
    setTrades(r.trades)
    setHints(r.hints)
    setSnapshots(r.snapshots)
    setBoard(r.leaderboard)
    setBroadcasts(r.broadcasts)
    setFinancials(r.financials)
    setMacro(r.macro)
    setSeed(r.seed)
    setCash(r.cash)
    setOptionsContracts(r.optionsContracts ?? [])
    setMyOptionPositions(r.myOptionPositions ?? [])
    setSelectedCode((c) => c ?? r.rawStocks[0]?.id ?? null)
    return true
  }, [])

  // 새로 읽은 값을 그대로 돌려준다 — 호출부가 setState 직후에 ref를 읽으면
  // 아직 렌더 전이라 옛 값을 본다.
  const refetch = useCallback(async () => {
    const t = teamRef.current
    if (!t) return { ok: false, error: 'no_team' }
    const r = await refetchMine(t.code, t.id)
    if (!r.ok) {
      pushToast(errorText(r.error), 'down')
      return r
    }
    setPositions(r.positions)
    setTrades(r.trades)
    setHints(r.hints)
    setSnapshots(r.snapshots)
    setBoard(r.leaderboard)
    setBroadcasts(r.broadcasts)
    setFinancials(r.financials)
    setMacro(r.macro)
    if (r.rawStocks) setRawStocks(r.rawStocks)
    if (r.pricePaths) setPricePaths(r.pricePaths)
    setGame(r.game)
    setCash(r.cash)
    setOptionsContracts(r.optionsContracts ?? [])
    setMyOptionPositions(r.myOptionPositions ?? [])
    return r
  }, [pushToast])

  // 카운트다운 1초 틱 — 타이머가 도는 동안만 의미가 있지만, 항상 돌려도 가볍다.
  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // 매매 마감 30초 전 알림 (라운드마다 한 번만). 타이머가 다시 열리면 초기화된다.
  const warned30 = useRef(false)
  useEffect(() => {
    if (tradingOpen && remainingMs > 0 && remainingMs <= 30000) {
      if (!warned30.current) {
        warned30.current = true
        pushToast('매매 마감 30초 전!', 'down')
      }
    } else if (!tradingOpen || remainingMs > 30000) {
      warned30.current = false
    }
  }, [remainingMs, tradingOpen, pushToast])

  // 파산 배너의 "닫기"는 이 라운드·이 기기 한정 — 연도가 넘어가면 (가격 재평가로 상황이 바뀌므로) 다시 보여준다
  useEffect(() => {
    setBankruptSeen(false)
  }, [game?.current_round])

  // 속보 팝업이 열려 있으면(그리고 목록이 갱신되면) 전부 읽음 처리 → 깜빡임 멈춤
  useEffect(() => {
    if (!bcOpen) return
    const maxId = broadcasts.reduce((m, b) => Math.max(m, Number(b.id)), 0)
    setSeenBc((prev) => Math.max(prev, maxId))
    try {
      localStorage.setItem('wts-seen-bc', String(maxId))
    } catch {
      /* 무시 */
    }
  }, [bcOpen, broadcasts])

  // ── 재접속 복원: 저장된 코드로 자동 재로그인
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        getJoinMode()
          .then((m) => alive && setJoinMode(m)) // 로그인 화면 분기용(공개 조회)
          .catch((e) => console.error('[boot:getJoinMode]', e))
        if (!loadTeam()) return
        const r = await restore()
        if (!alive) return
        if (r.ok) {
          setTeam(r.team)
          await load(r.team)
        }
      } catch (e) {
        console.error('[boot]', e)
      } finally {
        if (alive) setBooting(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [load])

  // ── 실시간 신호
  const seenRound = useRef(null)
  useEffect(() => {
    if (!team) return
    const off = subscribeSignals(
      async (sig) => {
        try {
          if (!sig || sig.kind === 'sheet_saved') return // 주문서 제출은 관리자만 본다

          const before = hintsRef.current.length
          const fresh = await refetch()
          if (!fresh?.ok) return

          if (sig.kind === 'hints_changed') {
            // 나에게 실제로 새 힌트가 왔을 때만 알린다.
            // 다른 조에 지급돼도 신호는 오지만 내 목록은 그대로다.
            if (fresh.hints.length > before) {
              // 누르면 힌트 팝업이 열린다
              pushToast('새로운 힌트가 도착했어요', 'gold', () => setHintsOpen(true))
            }
          } else if (sig.kind === 'timer_started') {
            pushToast('거래 시간이 시작됐어요', 'up')
          } else if (sig.kind === 'broadcast') {
            // 새 속보 도착 → 재난문자처럼 팝업으로 먼저 띄운다. 회수(deleted) 신호면 조용히 갱신만.
            if (!sig.payload?.deleted && fresh.broadcasts?.length) setAlertBc(fresh.broadcasts[0])
          } else if (sig.kind === 'game_reset') {
            pushToast('대회가 초기화되었어요', 'gold')
          } else if (sig.kind === 'game_ended') {
            pushToast('대회가 종료되었어요', 'gold')
          }
          // round_advanced는 game이 갱신되면 아래 effect가 요약 모달을 띄운다
        } catch (e) {
          console.error('[signal handler]', e)
        }
      },
      // 실시간이 끊겼다 다시 붙으면, 그 사이 놓친 라운드 전환·속보를 한 번 따라잡는다.
      (_ok, reconnected) => {
        if (reconnected) void refetch()
      },
    )
    return off
    // hints는 ref로 읽으므로 의존성에 넣지 않는다 (넣으면 구독이 계속 재생성된다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team, refetch, pushToast])

  // 라운드가 바뀌면 요약 모달
  useEffect(() => {
    const r = game?.current_round
    if (r == null) return
    const isEnd = r > (game.total_rounds ?? 0) // 종료(final_year 공개)면 라운드 요약 대신 결과 모달
    if (seenRound.current === null) {
      seenRound.current = r
      if (isEnd) setFinalOpen(true) // 이미 종료된 상태로 접속 → 결과 표시
      return
    }
    if (seenRound.current !== r && r >= 1) {
      seenRound.current = r
      if (isEnd) setFinalOpen(true)
      else setRoundSummary({ round: r, year: yearOf(game, r) })
    }
  }, [game])

  const handleLogin = useCallback(
    async (code) => {
      const r = await authLogin(code)
      if (!r.ok) return r
      setTeam(r.team)
      await load(r.team)
      return r
    },
    [load],
  )

  // 자율 입장(open): Login이 닉네임→PIN 흐름을 관리하고, 확정 시 commitTeam으로 입장한다.
  const handleJoin = useCallback((name, pin) => authJoin(name, pin), [])
  const commitTeam = useCallback(
    async (t) => {
      setTeam(t)
      await load(t)
    },
    [load],
  )

  const handleLogout = useCallback(() => {
    authLogout()
    setTeam(null)
    setMyOpen(false)
  }, [])

  // 재난문자 팝업 닫기 → 그 속보는 읽음 처리(종은 그만 깜빡이되 목록엔 남는다)
  const dismissAlert = useCallback(() => {
    setAlertBc((bc) => {
      const id = Number(bc?.id ?? 0)
      if (id) {
        setSeenBc((prev) => Math.max(prev, id))
        try {
          localStorage.setItem('wts-seen-bc', String(id))
        } catch {
          /* 무시 */
        }
      }
      return null
    })
  }, [])

  const actions = useMemo(
    () => makeActions({ getTeamCode: () => teamRef.current?.code, refetch, notify: pushToast }),
    [refetch, pushToast],
  )

  const placeOrder = useCallback(
    async (side, qty) => {
      if (!selectedCode || qty <= 0) return
      setPlacing(true)
      await actions.placeOrder(selectedCode, side, qty)
      setPlacing(false)
    },
    [actions, selectedCode],
  )

  const placeOptionOrder = useCallback(
    async (contractId, qty) => {
      if (!contractId || qty <= 0) return
      setPlacing(true)
      await actions.placeOptionOrder(contractId, qty)
      setPlacing(false)
    },
    [actions],
  )

  const quoteOptionPremium = useCallback((contractId) => actions.quoteOptionPremium(contractId), [actions])

  // OptionOrderPanel이 보고 있는 계약·프리미엄·수량 → PayoffDiagram이 같은 값으로 곡선을 그린다.
  const onHedgeQuoteChange = useCallback((contract, premiumPerUnit, qty) => {
    setHedgeQuote({ contract, premiumPerUnit, qty })
  }, [])

  const setStrokes = useCallback(
    (next) => setDrawings((d) => ({ ...d, [selectedCode]: next })),
    [selectedCode],
  )

  if (booting) {
    return (
      <>
        <RotateNotice />
        <div className="boot">
          <div className="spinner" />
          <p>불러오는 중…</p>
        </div>
      </>
    )
  }

  if (!team) {
    return (
      <>
        <RotateNotice />
        <Login
          mode={joinMode}
          onSubmit={handleLogin}
          onJoin={handleJoin}
          onCommit={commitTeam}
          theme={theme}
          onToggleTheme={onToggleTheme}
        />
      </>
    )
  }

  if (loading || !game || !selected) {
    return (
      <>
        <RotateNotice />
        <div className="boot">
          {loadError ? (
            <>
              <p className="boot-err">{errorText(loadError)}</p>
              <button className="act-btn buy" onClick={() => load(team)} style={{ maxWidth: 200 }}>
                다시 시도
              </button>
            </>
          ) : (
            <>
              <div className="spinner" />
              <p>대회 정보를 불러오는 중…</p>
            </>
          )}
        </div>
      </>
    )
  }

  return (
    <>
      <RotateNotice />
      <Header
        account={acct}
        team={team.name || team.code}
        round={{ round: game.current_round, year }}
        ended={ended}
        rank={myRank}
        teamCount={board.length}
        hintCount={hints.length}
        remainingMs={remainingMs}
        durationMs={durationMs}
        timerState={timerState}
        bellTotal={broadcasts.length}
        bellCount={unreadBc}
        onOpenBroadcasts={() => setBcOpen(true)}
        onOpenRanking={() => setRankOpen(true)}
        onOpenHints={() => setHintsOpen(true)}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onLogout={handleLogout}
      />

      {!started && (
        <div className="notstarted">아직 대회가 시작되지 않았어요. 강사 선생님을 기다려 주세요.</div>
      )}
      {bankrupt && !bankruptSeen && (
        <div className="bankrupt-warn">
          <span>
            💸 파산 위기! 자산이 원금의 20% 아래로 줄었어요. 힌트와 재무제표를 다시 보고 신중히 골라봐요 — 아직 기회는 있어요!
          </span>
          <button
            type="button"
            className="bankrupt-warn__close"
            onClick={() => setBankruptSeen(true)}
            aria-label="파산 위기 안내 닫기"
          >
            ✕
          </button>
        </div>
      )}

      <ModeTabs mode={mode} onChange={setMode} />

      <div className="app">
        <StockList
          stocks={stocks}
          selectedCode={selected.code}
          onSelect={setSelectedCode}
          onOpenMy={() => setMyOpen(true)}
          tradingOpen={tradingOpen}
          stepIndex={liveStep}
        />
        {mode === 'spot' ? (
          <>
            <Chart
              stock={selected}
              onOpenFinancial={() => setFinOpen(true)}
              onOpenMarket={started ? () => setMarketOpen(true) : undefined}
              strokes={drawings[selected.code] ?? []}
              onStrokesChange={setStrokes}
              tradingOpen={tradingOpen}
              round={game.current_round}
              roundYearMap={game.round_year_map}
              timerState={timerState}
              game={game}
            />
            <OrderSheet
              key={selected.code}
              stock={selected}
              execPrice={selExecPrice}
              stepIndex={liveStep}
              stocks={stocks}
              cash={cash}
              onOrder={placeOrder}
              onSelectStock={setSelectedCode}
              placing={placing}
              tradingOpen={tradingOpen}
              started={started}
              ended={ended}
              hasTraded={trades.length > 0}
              onNotify={pushToast}
            />
          </>
        ) : (
          <>
            <PayoffDiagram
              stock={selected}
              contract={hedgeQuote.contract}
              premiumPerUnit={hedgeQuote.premiumPerUnit}
              quantity={hedgeQuote.qty}
            />
            <OptionOrderPanel
              key={selected.code}
              stock={selected}
              contracts={optionsContracts}
              currentRound={game.current_round}
              cash={cash}
              tradingOpen={tradingOpen}
              started={started}
              ended={ended}
              placing={placing}
              onQuote={quoteOptionPremium}
              onOrder={placeOptionOrder}
              onQuoteChange={onHedgeQuoteChange}
              onNotify={pushToast}
            />
          </>
        )}
      </div>

      <MyModal
        open={myOpen}
        onClose={() => setMyOpen(false)}
        account={acct}
        realized={realizedTotal}
        stocks={stocks}
        history={trades.map((t) => {
          const d = new Date(t.created_at)
          const p2 = (n) => String(n).padStart(2, '0')
          return {
            time: `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`,
            round: t.round,
            year: yearOf(game, t.round),
            name: stocks.find((s) => s.code === t.stock_id)?.name ?? t.stock_id,
            side: t.side,
            price: Number(t.price),
            qty: t.quantity,
            amount: Number(t.price) * t.quantity,
            realized: Number(t.realized_pnl ?? 0),
          }
        })}
        rounds={rounds}
      />
      <RankingModal open={rankOpen} onClose={() => setRankOpen(false)} rows={rankRows} />
      <HintModal
        open={hintsOpen}
        onClose={() => setHintsOpen(false)}
        hints={hints}
        stocks={stocks}
        onSelectStock={setSelectedCode}
      />
      <BroadcastModal
        open={bcOpen}
        onClose={() => setBcOpen(false)}
        broadcasts={broadcasts}
        game={game}
      />
      <FinancialModal
        open={finOpen}
        onClose={() => setFinOpen(false)}
        stock={selected}
        round={{ round: game.current_round, year }}
        financials={financials}
      />
      <MarketModal
        open={marketOpen}
        onClose={() => setMarketOpen(false)}
        round={{ round: game.current_round, year }}
        macro={macro}
      />
      <RoundModal
        round={roundSummary}
        account={acct}
        stocks={stocks}
        rounds={rounds}
        rows={rankRows}
        rank={myRow?.rank ?? null}
        prevRank={myRow?.prev_rank ?? null}
        teamCount={board.length}
        prevEquity={
          roundSummary
            ? Number(snapshots.find((s) => s.round === roundSummary.round - 1)?.equity ?? seed)
            : null
        }
        onClose={() => setRoundSummary(null)}
      />
      <FinalModal
        open={finalOpen}
        onClose={() => setFinalOpen(false)}
        account={acct}
        rows={rankRows}
        finalYear={game.final_year}
      />

      <EmergencyBroadcast broadcast={alertBc} onClose={dismissAlert} />
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}
