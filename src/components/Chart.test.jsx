import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen, within, waitFor } from '@testing-library/react'
import Chart from './Chart'
import { useStudentNavigation } from '../useStudentNavigation'

// gameData.js가 정적 import하는 ../supabase는 실제 클라이언트를 만든다 — 여기선 안 쓴다.
vi.mock('../supabase', () => ({ supabase: {}, rpc: vi.fn(), select: vi.fn() }))

// jsdom엔 ResizeObserver가 없다. useSize()가 실측 픽셀을 재는데 0×0이면 SVG를 안 그린다.
beforeAll(() => {
  global.ResizeObserver = class {
    constructor(cb) {
      this.cb = cb
    }
    observe() {
      this.cb([{ contentRect: { width: 600, height: 300 } }])
    }
    disconnect() {}
  }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const roundYearMap = { 1: 2020, 2: 2021, 3: 2022 }
const flat = (v) => Array(252).fill(v)

// R1=2020 R2=2021 R3=2022(현재). 지금 라운드(2022)는 실제 252 경로, 과거는 평탄 경로.
const baseStock = {
  code: 'S01',
  name: '테스트전자',
  market: 'KOSPI',
  price: 12_000, // 2022 연말 확정가 = 경로 마지막 값
  delta: 2_000,
  chg: 20,
  halted: false,
  prices: { 2020: 9_000, 2021: 10_000, 2022: 12_000 },
  pricePath: flat(11_500).map((v, i) => v + i * 2), // 11,500 → ~12,002 우상향
  pricePathsByYear: {
    2020: flat(9_000),
    2021: flat(10_000),
    2022: flat(11_500).map((v, i) => v + i * 2),
  },
}
baseStock.pricePath = baseStock.pricePathsByYear[2022]

const GAME = {
  round_start_at: '2026-08-30T00:00:00Z',
  round_ends_at: '2026-08-30T00:10:00Z', // 10분
}
const at = (iso) => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}

const linePoints = (c) => {
  const el = c.querySelector('.price-line')
  return el ? el.getAttribute('points').trim().split(/\s+/) : []
}
const lastY = (c) => {
  const pts = linePoints(c)
  return pts.length ? Number(pts[pts.length - 1].split(',')[1]) : NaN
}
const noNaN = (c) =>
  [...c.querySelectorAll('.price-line, .price-fill, .nowline, .nowline-pulse')].every(
    (el) => !/NaN|undefined/.test(el.outerHTML),
  )

describe('Chart — 헤더 가격은 항상 연말 확정가(장중가 아님)', () => {
  it('거래 중이어도 상단 숫자는 stock.price 그대로다', () => {
    at('2026-08-30T00:05:00Z')
    const { container } = render(
      <Chart stock={baseStock} round={3} roundYearMap={roundYearMap} timerState="live" tradingOpen game={GAME} strokes={[]} onStrokesChange={() => {}} />,
    )
    expect(container.querySelector('.now').textContent).toBe('12,000')
  })

  it('거래정지 종목은 차트를 그리지 않는다', () => {
    const { container } = render(
      <Chart stock={{ ...baseStock, halted: true }} round={3} roundYearMap={roundYearMap} timerState="live" tradingOpen game={GAME} strokes={[]} onStrokesChange={() => {}} />,
    )
    expect(container.querySelector('.price-line')).toBeNull()
    expect(container.querySelector('.plot-empty')).not.toBeNull()
  })
})

describe('Chart — 진행률(스텝 인덱스)만큼만 실시간 경로를 드러낸다', () => {
  const renderAt = (iso, timerState) => {
    at(iso)
    return render(
      <Chart stock={baseStock} round={3} roundYearMap={roundYearMap} timerState={timerState} tradingOpen game={GAME} strokes={[]} onStrokesChange={() => {}} />,
    ).container
  }

  it('waiting: 지금 라운드 구간은 하나도 안 드러난다(과거 구간만)', () => {
    const waiting = linePoints(renderAt('2026-08-30T00:05:00Z', 'waiting')).length
    cleanup()
    const closed = linePoints(renderAt('2026-08-30T00:15:00Z', 'closed')).length
    expect(waiting).toBeLessThan(closed)
    expect(waiting).toBeGreaterThan(0) // 과거 라운드는 보인다
  })

  it('live: 시간이 지날수록 드러난 점이 늘어난다', () => {
    const early = linePoints(renderAt('2026-08-30T00:01:00Z', 'live')).length
    cleanup()
    const mid = linePoints(renderAt('2026-08-30T00:05:00Z', 'live')).length
    cleanup()
    const late = linePoints(renderAt('2026-08-30T00:09:30Z', 'live')).length
    expect(early).toBeLessThan(mid)
    expect(mid).toBeLessThan(late)
  })

  it('paused: 일시정지 순간까지 공개된 경로를 그대로 유지한다', () => {
    const live = linePoints(renderAt('2026-08-30T00:05:00Z', 'live')).length
    cleanup()
    const pausedGame = { ...GAME, round_paused_at: '2026-08-30T00:05:00Z' }
    at('2026-08-30T00:09:00Z')
    const paused = linePoints(render(
      <Chart stock={baseStock} round={3} roundYearMap={roundYearMap} timerState="paused"
        tradingOpen={false} game={pausedGame} strokes={[]} onStrokesChange={() => {}} />,
    ).container).length
    expect(paused).toBe(live)
  })

  it('closed: 지금 라운드 경로가 끝까지 드러나고, 마지막 점 = 연말가에 대응한다', () => {
    const c = renderAt('2026-08-30T00:20:00Z', 'closed')
    // 마지막 그려진 점의 y가 플롯 상단쪽(값이 큼 = 우상향 종목)
    const ys = linePoints(c).map((p) => Number(p.split(',')[1]))
    expect(lastY(c)).toBe(Math.min(...ys))
    expect(noNaN(c)).toBe(true)
  })

  it('실시간 펄스 점은 거래 중일 때만 뜨고 우측 끝에 붙는다', () => {
    const c = renderAt('2026-08-30T00:05:00Z', 'live')
    const pulse = c.querySelector('.nowline-pulse')
    expect(pulse).not.toBeNull()
    const lineTipX = Number(linePoints(c).at(-1).split(',')[0])
    expect(Number(pulse.getAttribute('cx'))).toBeCloseTo(lineTipX, 1)
  })
})

describe('Chart — 이상값/정보 부족에도 죽지 않는다', () => {
  it('game이 없어도(진행률 계산 불가) closed처럼 안전하게 그린다', () => {
    const { container } = render(
      <Chart stock={baseStock} round={3} roundYearMap={roundYearMap} timerState="closed" tradingOpen={false} strokes={[]} onStrokesChange={() => {}} />,
    )
    expect(noNaN(container)).toBe(true)
    expect(linePoints(container).length).toBeGreaterThan(1)
  })

  it('경로가 없고 확정가도 0이면 현재가 한 점으로 대체되고 NaN이 없다', () => {
    const bare = { ...baseStock, price: 0, prices: {}, pricePath: null, pricePathsByYear: {} }
    const { container } = render(
      <Chart stock={bare} round={0} roundYearMap={{}} timerState={null} tradingOpen={false} strokes={[]} onStrokesChange={() => {}} />,
    )
    expect(noNaN(container)).toBe(true)
  })

  it('경로 값에 0(거래정지 스텝)이 섞여 있어도 SVG 좌표에 NaN이 안 샌다', () => {
    const holed = {
      ...baseStock,
      pricePath: baseStock.pricePath.map((v, i) => (i % 10 === 0 ? 0 : v)),
      pricePathsByYear: { ...baseStock.pricePathsByYear, 2022: baseStock.pricePath.map((v, i) => (i % 10 === 0 ? 0 : v)) },
    }
    at('2026-08-30T00:15:00Z')
    const { container } = render(
      <Chart stock={holed} round={3} roundYearMap={roundYearMap} timerState="closed" tradingOpen game={GAME} strokes={[]} onStrokesChange={() => {}} />,
    )
    expect(noNaN(container)).toBe(true)
  })
})

describe('Chart — 모바일 크게 보기', () => {
  it('현재 공개된 경로와 메모를 유지하고 기간 변경을 원래 차트에 반영한다', () => {
    at('2026-08-30T00:05:00Z')
    const strokes = [{ id: 'memo', points: [[0.2, 0.3], [0.7, 0.6]] }]
    const { container } = render(
      <Chart stock={baseStock} round={3} roundYearMap={roundYearMap} timerState="live"
        tradingOpen game={GAME} strokes={strokes} onStrokesChange={() => {}} />,
    )
    const originalPoints = linePoints(container)
    const open = screen.getByRole('button', { name: '크게 보기' })
    open.focus()
    fireEvent.click(open)
    const dialog = screen.getByRole('dialog', { name: '테스트전자 차트 크게 보기' })
    expect(linePoints(dialog)).toEqual(originalPoints)
    expect(dialog.querySelector('.stroke').getAttribute('points'))
      .toBe(container.querySelector('.stroke').getAttribute('points'))
    const gradientIds = [...document.querySelectorAll('linearGradient')].map((el) => el.id)
    expect(new Set(gradientIds).size).toBe(2)
    fireEvent.click(within(dialog).getByRole('button', { name: '일', exact: true }))
    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: '일', exact: true }).getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(open)
    fireEvent.click(open)
    history.replaceState({ ...history.state, cuficChartLarge: null }, '')
    fireEvent(window, new PopStateEvent('popstate'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('휴대폰 뒤로가기는 확대창만 닫고 종목 상세에 머문다', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    history.replaceState({}, '')
    function PhoneChart() {
      const { view, setView } = useStudentNavigation()
      return view === 'stocks' ? <button onClick={() => setView('analysis')}>종목 열기</button> : <>
        <span>종목 상세</span>
        <Chart stock={baseStock} round={3} roundYearMap={roundYearMap} timerState="closed"
          tradingOpen={false} game={GAME} strokes={[]} onStrokesChange={() => {}} />
      </>
    }
    render(<PhoneChart />)
    fireEvent.click(screen.getByRole('button', { name: '종목 열기' }))
    await screen.findByText('종목 상세')
    fireEvent.click(screen.getByRole('button', { name: '크게 보기' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    history.back()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('종목 상세')).toBeInTheDocument()
  })
})
