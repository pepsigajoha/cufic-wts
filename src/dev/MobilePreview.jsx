// 로컬 Vite 전용: 실제 UI에 예시 데이터와 메모리 내 동작만 연결한다. 게임 데이터를 저장하지 않는다.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { stocks as seedStocks, financials, MACRO, initialHints, ROUNDS, PRINCIPAL, FINAL_YEAR } from '../data'
import { FIN_INPUTS } from '../metrics'
import { buildStocks, execPriceOf } from '../gameData'
import { deriveAccount } from '../account'
import { roundStepIndex } from '../chart'
import Header from '../components/Header'
import TradeStatusStrip from '../components/TradeStatusStrip'
import ModeTabs from '../components/ModeTabs'
import StudentWorkspace from '../components/StudentWorkspace'
import { useStudentNavigation } from '../useStudentNavigation'
import StockList from '../components/StockList'
import Chart from '../components/Chart'
import JudgmentDock from '../components/JudgmentDock'
import OrderSheet from '../components/OrderSheet'
import Savings from '../components/Savings'
import PayoffDiagram from '../components/PayoffDiagram'
import OptionOrderPanel from '../components/OptionOrderPanel'
import MyModal from '../components/MyModal'
import FinancialModal from '../components/FinancialModal'
import MarketModal from '../components/MarketModal'
import HintModal from '../components/HintModal'
import RankingModal from '../components/RankingModal'
import Modal from '../components/Modal'
import Toasts, { useToasts } from '../components/Toast'
import AdminHeader from '../admin/AdminHeader'
import AdminNavigation from '../admin/AdminNavigation'
import FloatingRoundDock from '../admin/FloatingRoundDock'
import AdminProgress from '../admin/AdminProgress'
import AdminBoard from '../admin/AdminBoard'
import AdminContent from '../admin/AdminContent'
import AdminStocks from '../admin/AdminStocks'
import AdminTeams from '../admin/AdminTeams'
import AdminHints from '../admin/AdminHints'
import AdminOptions from '../admin/AdminOptions'
import AdminAnalytics from '../admin/AdminAnalytics'
import AdminDatasets from '../admin/AdminDatasets'
import AdminSimulator from '../admin/AdminSimulator'
import AdminSystem from '../admin/AdminSystem'
import '../index.css'
import '../admin.css'
import './mobile-preview.css'

const rawStocks = seedStocks.map((s) => ({ id: s.code, name: s.name, description: s.desc, prices: s.priceByYear, listed_from_round: s.listedFromRound, display_order: s.displayOrder }))
const roundYearMap = Object.fromEntries(ROUNDS.map((r) => [r.round, r.year]))
const finRows = Object.entries(financials).flatMap(([id, years]) => Object.entries(years).filter(([, f]) => f).map(([year, f]) => ({ stock_id: id, year: Number(year), ...Object.fromEntries(FIN_INPUTS.map((m) => [m.db, f[m.key]])) })))
const hints = initialHints.map((h, i) => ({ ...h, id: i + 1, related_stock_ids: h.related ?? [], granted_to: ['DEMO-2'] }))
const paths = rawStocks.flatMap((s) => ROUNDS.map(({ year }) => {
  const end = Number(s.prices[year]) || 0
  const start = Number(s.prices[year - 1]) || end
  return { stock_id: s.id, year, prices: Array.from({ length: 252 }, (_, i) => Math.round(start + (end - start) * i / 251 + Math.sin(i / 14) * end * 0.025)) }
}))
const teams = ['불꽃투자단', '차분한투자자', '우리조'].map((name, i) => ({ team_id: `DEMO-${i}`, code: `DEMO-${i}`, name, rank: i + 1, prev_rank: i + 2, seed: PRINCIPAL, cash: PRINCIPAL, equity: PRINCIPAL * (1.2 - i * 0.1), pnl: PRINCIPAL * (0.2 - i * 0.1), pnl_pct: 20 - i * 10, trades_this_round: i + 1, last_seen_at: new Date().toISOString() }))
const datasets = [{ id: 1, name: '스마트 주식 교실 · 예시 시나리오', description: '모바일 레이아웃 확인용 데이터' }]
const ADMIN_PAGES = { progress: AdminProgress, board: AdminBoard, content: AdminContent, stocks: AdminStocks, teams: AdminTeams, hints: AdminHints, options: AdminOptions, analytics: AdminAnalytics, datasets: AdminDatasets, simulator: AdminSimulator, system: AdminSystem }

function Preview() {
  const [surface, setSurface] = useState('student')
  const [theme, setTheme] = useState('dark')
  const { mode, setMode, view, setView } = useStudentNavigation()
  const [orderSide, setOrderSide] = useState('buy')
  const [tab, setTab] = useState('progress')
  const [selectedCode, setSelectedCode] = useState(rawStocks[0].id)
  const [modal, setModal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [fail, setFail] = useState(false)
  const [cash, setCash] = useState(PRINCIPAL)
  const [positions, setPositions] = useState([])
  const [savings, setSavings] = useState([{ id: 1, principal: 1000000, balance: 1050000, start_round: 1 }])
  const [drawings, setDrawings] = useState({})
  const [quote, setQuote] = useState({})
  const [toasts, notify, dismissToast] = useToasts()
  const [game, setGame] = useState(() => ({ current_round: 2, total_rounds: ROUNDS.length, round_year_map: roundYearMap, final_year: FINAL_YEAR, default_seed: PRINCIPAL, round_duration_seconds: 600, round_start_at: new Date(Date.now() - 300000).toISOString(), round_ends_at: new Date(Date.now() + 300000).toISOString(), round_paused_at: null, active_dataset_id: 1, enable_options: true, enable_savings: true }))
  const [now, setNow] = useState(Date.now())
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])
  const stocks = useMemo(() => buildStocks(rawStocks, game, positions, paths), [game, positions])
  const stock = stocks.find((s) => s.code === selectedCode) ?? stocks[0]
  const year = roundYearMap[game.current_round]
  const step = roundStepIndex(game, now)
  const remain = Math.max(0, Date.parse(game.round_ends_at) - (Date.parse(game.round_paused_at) || now))
  const timerState = game.round_paused_at ? 'paused' : remain > 0 ? 'live' : 'closed'
  const tradingOpen = timerState === 'live'
  const account = deriveAccount(stocks, cash, PRINCIPAL, savings.reduce((s, d) => s + d.balance, 0))
  const contracts = useMemo(() => [{ id: 1, stock_id: stock.code, option_type: 'put', strike: stock.price, expiry_round: game.current_round + 1, implied_vol: 0.35, active: true }], [stock.code, stock.price, game.current_round])
  const onQuote = useCallback(async () => ({ ok: true, premium_per_unit: 1000 }), [])
  const onQuoteChange = useCallback((contract, premium, qty) => setQuote({ contract, premium, qty }), [])
  const toggleTheme = () => setTheme((t) => t === 'dark' ? 'light' : 'dark')
  const close = () => setModal(null)
  const refresh = async () => {}
  const demoOrder = async (side, qty) => {
    setBusy(true)
    await new Promise((r) => setTimeout(r, 350))
    setBusy(false)
    if (fail) return { ok: false, error: 'network' }
    const price = execPriceOf(stock, step)
    setCash((c) => c + (side === 'buy' ? -1 : 1) * qty * price)
    setPositions((ps) => [...ps.filter((p) => p.stock_id !== stock.code), { stock_id: stock.code, quantity: stock.holding + (side === 'buy' ? qty : -qty), avg_price: price }])
    return { ok: true, price }
  }
  const disabledAction = async () => ({ ok: false, error: '미리보기에서는 이 작업을 저장하지 않아요.' })
  const actions = {
    upsertOptionsContract: disabledAction,
    deactivateOptionsContract: disabledAction,
    generateBreakingNews: disabledAction,
    listDatasets: async () => ({ ok: true, datasets }),
    startTimer: async (minutes) => { setGame((g) => ({ ...g, round_start_at: new Date().toISOString(), round_ends_at: new Date(Date.now() + minutes * 60000).toISOString(), round_paused_at: null })); return { ok: true } },
    pauseTimer: async () => { setGame((g) => ({ ...g, round_paused_at: new Date().toISOString() })); return { ok: true } },
    resumeTimer: async () => { setGame((g) => { const delta = Date.now() - Date.parse(g.round_paused_at); return { ...g, round_start_at: new Date(Date.parse(g.round_start_at) + delta).toISOString(), round_ends_at: new Date(Date.parse(g.round_ends_at) + delta).toISOString(), round_paused_at: null } }); return { ok: true } },
    adjustTimer: async (seconds) => { setGame((g) => ({ ...g, round_ends_at: new Date(Date.parse(g.round_ends_at) + seconds * 1000).toISOString() })); return { ok: true } },
    ...Object.fromEntries(['advanceRound', 'endGame', 'setGamePin', 'sendBroadcast', 'deleteBroadcast', 'setFlatPricing', 'setStudentFeatures', 'loadDataset', 'saveDataset', 'deleteDataset', 'getDataset', 'importDataset', 'upsertMacro', 'upsertFinancial', 'deleteFinancial', 'upsertStock', 'deleteStock', 'upsertHint', 'deleteHint', 'grantHints', 'revokeHint', 'resetGame', 'updateGameConfig', 'computeTeamAnalytics', 'applySimulatedPrices', 'applyGeneratedContent', 'upsertRoundQuarterConfig', 'createTeam', 'deleteTeam', 'renameTeam', 'setTeamSeed', 'upsertOptionContract', 'deleteOptionContract'].map((key) => [key, disabledAction])),
  }
  const shared = { actions, game, stocks: rawStocks, teams, gamePin: null, board: teams, hints, broadcasts: [], financials: finRows, macro: Object.entries(MACRO).map(([y, m]) => ({ ...m, year: Number(y) })), optionsContracts: contracts, analytics: [], refresh, refreshLive: refresh, notify, dirty: false, onSaved: refresh, liveOn: false }
  const Page = ADMIN_PAGES[tab]

  return <>
    <div className="preview-toolbar">
      <label><span>미리보기</span><select aria-label="미리보기 화면" value={surface} onChange={(e) => setSurface(e.target.value)}><option value="student">학생</option><option value="admin">관리자</option></select></label>
      <span>예시 데이터 · 실제 게임 변경 없음</span>
      {surface === 'student' && <label className="preview-failure"><input type="checkbox" checked={fail} onChange={(e) => setFail(e.target.checked)} />주문 실패</label>}
    </div>
    {surface === 'student' ? <>
      <Header account={account} team="우리조" round={{ round: game.current_round, year }} rank={3} teamCount={teams.length} hintCount={hints.filter((h) => h.round === game.current_round).length} remainingMs={remain} durationMs={game.round_duration_seconds * 1000} timerState={timerState} theme={theme} onToggleTheme={toggleTheme} onOpenRanking={() => setModal('rank')} onOpenHints={() => setModal('hint')} onLogout={() => setModal('login')} />
      <TradeStatusStrip state={timerState}><ModeTabs mode={mode} onChange={(m) => { setMode(m); setView(m === 'savings' ? 'order' : 'analysis') }} /></TradeStatusStrip>
      <StudentWorkspace view={view} onViewChange={setView} mode={mode} stock={stock} cash={cash} tradingOpen={tradingOpen} onOrderSide={setOrderSide} onOpenMy={() => setModal('my')}>
        <StockList stocks={stocks} selectedCode={stock.code} onSelect={(id) => { setSelectedCode(id); setView('analysis') }} onOpenMy={() => setModal('my')} tradingOpen={tradingOpen} stepIndex={step} />
        {mode === 'spot' ? <>
          <div className="col chart-col"><Chart stock={stock} strokes={drawings[stock.code] ?? []} onStrokesChange={(s) => setDrawings((d) => ({ ...d, [stock.code]: s }))} tradingOpen={tradingOpen} round={game.current_round} roundYearMap={roundYearMap} timerState={timerState} game={game} onOpenFinancial={() => setModal('fin')} onOpenMarket={() => setModal('market')} /><JudgmentDock stock={stock} financials={financials} macro={MACRO} round={{ round: game.current_round, year }} hints={hints.filter((h) => h.round === game.current_round)} onOpenFinancial={() => setModal('fin')} onOpenMarket={() => setModal('market')} onOpenHints={() => setModal('hint')} /></div>
          <OrderSheet key={stock.code} side={orderSide} onSideChange={setOrderSide} stock={stock} stocks={stocks} execPrice={execPriceOf(stock, step)} stepIndex={step} cash={cash} tradingOpen={tradingOpen} started placing={busy} onOrder={demoOrder} onSelectStock={setSelectedCode} onNotify={notify} />
        </> : mode === 'savings' ? <Savings savings={savings} rate={MACRO[year]?.rate} macro={MACRO} round={game.current_round} roundYearMap={roundYearMap} cash={cash} started busy={busy} onNotify={notify} onOpen={async (amount) => { setCash((c) => c - amount); setSavings((ss) => [...ss, { id: Date.now(), principal: amount, balance: amount, start_round: game.current_round }]); return { ok: true } }} onWithdraw={async (id) => { const s = savings.find((d) => d.id === id); setCash((c) => c + s.principal + Math.round((s.balance - s.principal) / 2)); setSavings((ss) => ss.filter((s) => s.id !== id)); return { ok: true } }} /> : <>
          <PayoffDiagram stock={stock} contract={quote.contract} premiumPerUnit={quote.premium} quantity={quote.qty} />
          <OptionOrderPanel key={stock.code} stock={stock} contracts={contracts} currentRound={game.current_round} cash={cash} tradingOpen={tradingOpen} started placing={busy} onQuote={onQuote} onOrder={disabledAction} onQuoteChange={onQuoteChange} />
        </>}
      </StudentWorkspace>
      <MyModal open={modal === 'my'} onClose={close} account={account} realized={0} stocks={stocks} history={[]} rounds={[]} />
      <FinancialModal open={modal === 'fin'} onClose={close} stock={stock} round={{ round: game.current_round, year }} financials={financials} />
      <MarketModal open={modal === 'market'} onClose={close} round={{ round: game.current_round, year }} macro={MACRO} />
      <HintModal open={modal === 'hint'} onClose={close} hints={hints.filter((h) => h.round === game.current_round)} stocks={stocks} onSelectStock={(id) => { setSelectedCode(id); setView('analysis') }} />
      <RankingModal open={modal === 'rank'} onClose={close} rows={teams.map((t) => ({ ...t, pnlPct: t.pnl_pct, me: t.name === '우리조' }))} />
      <Modal open={modal === 'login'} onClose={close} title="디자인 미리보기"><p>실제 입장은 기본 학생 화면에서 진행하세요.</p><a href="/">학생 입장 화면 열기</a></Modal>
    </> : <div className="admin">
      <AdminHeader game={game} teams={teams} connected theme={theme} onToggleTheme={toggleTheme} onLogout={() => setSurface('student')} />
      <div className="admin-body"><AdminNavigation tab={tab} onChange={setTab} /><main className="admin-main" key={tab}><Page {...shared} /></main></div>
      <FloatingRoundDock game={game} stocks={rawStocks} actions={actions} notify={notify} refresh={refresh} onNavigate={setTab} />
    </div>}
    <Toasts toasts={toasts} onDismiss={dismissToast} />
  </>
}

createRoot(document.getElementById('root')).render(<Preview />)
