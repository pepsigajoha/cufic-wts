import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import Chart from './Chart'
import { pct } from '../format'

// gameData.js가 정적 import하는 ../supabase는 실제 클라이언트를 만든다 — buildStocks는
// 순수 함수라 실제 네트워크가 전혀 필요 없으므로 가볍게 대역만 채운다.
vi.mock('../supabase', () => ({ supabase: {}, rpc: vi.fn(), select: vi.fn() }))
import { buildStocks } from '../gameData'

// jsdom엔 ResizeObserver가 없다. useSize()가 이걸로 실측 픽셀을 재는데, 0×0이면
// Chart가 "ready"로 안 잡혀 SVG를 아예 안 그린다 — 테스트에서 고정 크기를 즉시 흘려준다.
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

afterEach(cleanup)

const stock = {
  code: 'S01',
  name: '테스트전자',
  market: 'KOSPI',
  price: 10_000,
  delta: 500,
  chg: 5,
  halted: false,
  prices: { 2020: 9_000, 2021: 9_500, 2022: 10_000 },
}
// R1=2020 .. R3=2022(현재). 과거 구간 2개(R0→R1, R1→R2)는 항상 tf.count=60을 쓴다
// (1 + 2×59 = 119). 지금 구간(R2→R3, 라이브)은 durationMs가 있고 tfKey='T'(틱)면
// SUB_TICK_INTERVAL_MS(1초)로 역산한다 — durationMs=10분이면 600틱(=count) → 119 + (600-1) = 718.
const roundYearMap = { 1: 2020, 2: 2021, 3: 2022 }
const FULL_LEN = 718
const WAITING_LEN = 119 // 마지막(라이브) 구간을 아직 하나도 안 드러낸 상태

const pointCount = (container) =>
  container.querySelector('.price-line').getAttribute('points').trim().split(/\s+/).length

describe('실시간 틱 — 순수 시각 효과, 공식가는 절대 안 바뀐다', () => {
  it('거래 시간이 아니면(tradingOpen=false) 상단 가격은 공식가 그대로다', () => {
    // y축 눈금에도 "10,000"이 같이 뜰 수 있어(niceTicks) 헤더 전용 클래스(.now)로 좁혀서 본다.
    const { container } = render(
      <Chart stock={stock} onOpenFinancial={() => {}} strokes={[]} onStrokesChange={() => {}} tradingOpen={false} />,
    )
    expect(container.querySelector('.now').textContent).toBe('10,000')
  })

  it('거래 시간이어도(tradingOpen=true) 상단 가격은 여전히 공식가다 — 절대 다른 숫자를 보여주면 안 된다', () => {
    const { container } = render(
      <Chart
        stock={stock}
        onOpenFinancial={() => {}}
        strokes={[]}
        onStrokesChange={() => {}}
        tradingOpen
        remainingMs={90_000}
        round={3}
        roundYearMap={roundYearMap}
        timerState="live"
      />,
    )
    expect(container.querySelector('.now').textContent).toBe('10,000')
  })

  it('거래 중엔 헤더에 순수 장식용 live-dot이 뜨지만, 가격·등락률 텍스트는 절대 안 바뀐다', () => {
    const { container } = render(
      <Chart
        stock={stock}
        onOpenFinancial={() => {}}
        strokes={[]}
        onStrokesChange={() => {}}
        tradingOpen
        remainingMs={90_000}
        round={3}
        roundYearMap={roundYearMap}
        timerState="live"
      />,
    )
    expect(container.querySelector('.live-dot')).not.toBeNull()
    expect(container.querySelector('.now').textContent).toBe('10,000')
    expect(container.querySelector('.delta').textContent).toContain(pct(stock.chg))
  })

  it('거래 시간이 아니면 live-dot도 뜨지 않는다', () => {
    const { container } = render(
      <Chart stock={stock} onOpenFinancial={() => {}} strokes={[]} onStrokesChange={() => {}} tradingOpen={false} />,
    )
    expect(container.querySelector('.live-dot')).toBeNull()
  })

  it('거래 시간이 아니면 실시간 펄스 점이 안 뜬다', () => {
    const { container } = render(
      <Chart stock={stock} onOpenFinancial={() => {}} strokes={[]} onStrokesChange={() => {}} tradingOpen={false} />,
    )
    expect(container.querySelector('.nowline-pulse')).toBeNull()
  })

  it('거래 시간이면(라운드 정보가 갖춰지면) 실시간 펄스 점이 뜬다', () => {
    const { container } = render(
      <Chart
        stock={stock}
        onOpenFinancial={() => {}}
        strokes={[]}
        onStrokesChange={() => {}}
        tradingOpen
        remainingMs={90_000}
        round={3}
        roundYearMap={roundYearMap}
        timerState="live"
      />,
    )
    expect(container.querySelector('.nowline-pulse')).not.toBeNull()
  })

  it('거래정지 종목은 틱 여부와 무관하게 차트를 안 그린다(기존 동작 유지)', () => {
    render(
      <Chart
        stock={{ ...stock, halted: true }}
        onOpenFinancial={() => {}}
        strokes={[]}
        onStrokesChange={() => {}}
        tradingOpen
        remainingMs={90_000}
      />,
    )
    expect(screen.getByText('거래가 정지된 종목이라 차트가 없어요')).toBeInTheDocument()
  })
})

describe('데이터 흐름 안전성 — 라운드 전환·이상값에도 죽지 않는다', () => {
  it('라운드가 넘어가 가격·round·remainingMs가 한꺼번에 바뀌어도 크래시 없이 새 가격을 반영한다', () => {
    const { container, rerender } = render(
      <Chart
        stock={stock}
        onOpenFinancial={() => {}}
        strokes={[]}
        onStrokesChange={() => {}}
        tradingOpen
        remainingMs={90_000}
        round={3}
        roundYearMap={roundYearMap}
        timerState="live"
      />,
    )
    expect(container.querySelector('.now').textContent).toBe('10,000')

    const nextStock = { ...stock, price: 14_200, delta: 4_200, chg: 42, prices: { ...stock.prices, 2023: 14_200 } }
    rerender(
      <Chart
        stock={nextStock}
        onOpenFinancial={() => {}}
        strokes={[]}
        onStrokesChange={() => {}}
        tradingOpen={false}
        remainingMs={0}
        round={4}
        roundYearMap={{ ...roundYearMap, 4: 2023 }}
        timerState="closed"
      />,
    )
    expect(container.querySelector('.now').textContent).toBe('14,200')
  })

  it('등락폭이 0(변동성 0)이어도 y축 스케일 나눗셈이 깨지지 않고 그대로 그려진다', () => {
    const flat = { ...stock, price: 10_000, delta: 0, chg: 0 }
    const { container } = render(
      <Chart
        stock={flat}
        onOpenFinancial={() => {}}
        strokes={[]}
        onStrokesChange={() => {}}
        tradingOpen
        remainingMs={90_000}
        round={3}
        roundYearMap={roundYearMap}
        timerState="live"
      />,
    )
    const line = container.querySelector('.nowline')
    expect(line).not.toBeNull()
    for (const attr of ['y1', 'y2']) {
      expect(Number.isFinite(Number(line.getAttribute(attr)))).toBe(true)
    }
  })

  it('가격이 0(거래정지 데이터)으로 들어와도 SVG 좌표에 NaN이 새 나가지 않는다', () => {
    const halted = { ...stock, price: 0, delta: 0, chg: 0, halted: true }
    const { container } = render(
      <Chart
        stock={halted}
        onOpenFinancial={() => {}}
        strokes={[]}
        onStrokesChange={() => {}}
        tradingOpen
        remainingMs={90_000}
        round={3}
        roundYearMap={roundYearMap}
        timerState="live"
      />,
    )
    // halted면 가격선·nowline을 그리는 차트 svg 자체를 안 그리므로(안내 문구만) NaN이
    // DOM에 나갈 자리가 없다. (그림판 DrawLayer의 빈 svg는 별개라 nowline으로 좁혀 본다)
    expect(container.querySelector('.nowline')).toBeNull()
    expect(screen.getByText('거래가 정지된 종목이라 차트가 없어요')).toBeInTheDocument()
  })

  it('관리자가 admin_apply_simulated_prices로 적용한 새 raw 가격이 buildStocks를 거쳐 차트 기준선까지 그대로 반영된다', () => {
    const game = { current_round: 3, round_year_map: { 1: 2020, 2: 2021, 3: 2022 } }
    const before = [{ id: 'S01', name: '테스트전자', display_order: 1, prices: { 2021: 9_000, 2022: 10_000 } }]
    const [stockBefore] = buildStocks(before, game, [])

    const { container, rerender } = render(
      <Chart stock={stockBefore} onOpenFinancial={() => {}} strokes={[]} onStrokesChange={() => {}} tradingOpen={false} />,
    )
    expect(container.querySelector('.now').textContent).toBe('10,000')

    // admin_apply_simulated_prices는 stocks.prices를 통째로 교체한다 — 그 결과를 그대로 흉내낸다.
    const after = [{ id: 'S01', name: '테스트전자', display_order: 1, prices: { 2021: 9_000, 2022: 12_300 } }]
    const [stockAfter] = buildStocks(after, game, [])

    rerender(
      <Chart stock={stockAfter} onOpenFinancial={() => {}} strokes={[]} onStrokesChange={() => {}} tradingOpen={false} />,
    )
    expect(container.querySelector('.now').textContent).toBe('12,300')
  })
})

describe('[1틱 트레딩] 과거 라운드는 항상 고정, 지금 라운드 구간만 실시간으로 이어 그려진다', () => {
  const DURATION = 10 * 60 * 1000 // round_duration_seconds 기본값(10분)

  it('"틱" 시간대는 라운드 길이와 무관하게 항상 SUB_TICK_INTERVAL_MS(1초)마다 한 틱이다', () => {
    // 10분(600초) 라운드 → 600틱. 마감 순간(전부 드러남) 총 점 개수로 역산해 확인한다.
    const { container: c10 } = render(
      <Chart
        stock={stock}
        onOpenFinancial={() => {}}
        strokes={[]}
        onStrokesChange={() => {}}
        tradingOpen
        remainingMs={0}
        durationMs={10 * 60 * 1000}
        round={3}
        roundYearMap={roundYearMap}
        timerState="live"
      />,
    )
    expect(pointCount(c10)).toBe(WAITING_LEN + (600 - 1)) // 718

    // 5분(300초) 라운드 → 300틱 — 라운드가 짧아지면 틱 개수도 그만큼 줄어야 한다(항상 1초 간격).
    const { container: c5 } = render(
      <Chart
        stock={stock}
        onOpenFinancial={() => {}}
        strokes={[]}
        onStrokesChange={() => {}}
        tradingOpen
        remainingMs={0}
        durationMs={5 * 60 * 1000}
        round={3}
        roundYearMap={roundYearMap}
        timerState="live"
      />,
    )
    expect(pointCount(c5)).toBe(WAITING_LEN + (300 - 1)) // 418
  })

  it('타이머 시작 전(waiting)엔 지금 라운드 구간이 아예 안 드러난다 — 완성된 그래프가 미리 보이지 않는다', () => {
    const { container } = render(
      <Chart
        stock={stock}
        onOpenFinancial={() => {}}
        strokes={[]}
        onStrokesChange={() => {}}
        tradingOpen={false}
        remainingMs={DURATION}
        durationMs={DURATION}
        round={3}
        roundYearMap={roundYearMap}
        timerState="waiting"
      />,
    )
    expect(pointCount(container)).toBe(WAITING_LEN)
  })

  it('거래가 막 시작된 순간(live, 남은 시간=전체)엔 대기 상태와 똑같이 경계점 하나만 보인다', () => {
    // revealFrac은 1 - remainingMs/durationMs = 0으로 waiting과 동일 — 다음 렌더부터 늘어난다.
    const { container } = render(
      <Chart
        stock={stock}
        onOpenFinancial={() => {}}
        strokes={[]}
        onStrokesChange={() => {}}
        tradingOpen
        remainingMs={DURATION}
        durationMs={DURATION}
        round={3}
        roundYearMap={roundYearMap}
        timerState="live"
      />,
    )
    expect(pointCount(container)).toBe(WAITING_LEN)
  })

  it('라운드가 절반 지났으면 지금 구간도 절반쯤 드러난다', () => {
    const { container } = render(
      <Chart
        stock={stock}
        onOpenFinancial={() => {}}
        strokes={[]}
        onStrokesChange={() => {}}
        tradingOpen
        remainingMs={DURATION / 2}
        durationMs={DURATION}
        round={3}
        roundYearMap={roundYearMap}
        timerState="live"
      />,
    )
    const n = pointCount(container)
    expect(n).toBeGreaterThan(WAITING_LEN + 1)
    expect(n).toBeLessThan(FULL_LEN)
  })

  it('남은 시간이 0이 되면 정확히 전체 경로(과거 전체+지금 라운드)가 다 드러난다', () => {
    const { container } = render(
      <Chart
        stock={stock}
        onOpenFinancial={() => {}}
        strokes={[]}
        onStrokesChange={() => {}}
        tradingOpen
        remainingMs={0}
        durationMs={DURATION}
        round={3}
        roundYearMap={roundYearMap}
        timerState="live"
      />,
    )
    expect(pointCount(container)).toBe(FULL_LEN)
  })

  it('라운드가 끝난 뒤(closed)엔 다 그려진 채로 유지된다', () => {
    const { container } = render(
      <Chart
        stock={stock}
        onOpenFinancial={() => {}}
        strokes={[]}
        onStrokesChange={() => {}}
        tradingOpen={false}
        remainingMs={0}
        durationMs={DURATION}
        round={3}
        roundYearMap={roundYearMap}
        timerState="closed"
      />,
    )
    expect(pointCount(container)).toBe(FULL_LEN)
  })

  it('실시간 점(pulse)은 항상 플롯 우측 끝에 고정되고, 그 뒤로 선이 자라난다(폭이 항상 꽉 찬다)', () => {
    // x축을 "지금까지 드러난 점 개수" 기준으로 매번 다시 잡으므로, 진행률과 무관하게
    // 마지막 점(= 점) 은 항상 우측 끝(w-PAD.r)에 닿는다 — 오른쪽에 빈 공간이 안 생긴다.
    const early = render(
      <Chart
        stock={stock}
        onOpenFinancial={() => {}}
        strokes={[]}
        onStrokesChange={() => {}}
        tradingOpen
        remainingMs={DURATION}
        durationMs={DURATION}
        round={3}
        roundYearMap={roundYearMap}
        timerState="live"
      />,
    )
    const cxEarly = Number(early.container.querySelector('.nowline-pulse').getAttribute('cx'))
    early.unmount()

    const late = render(
      <Chart
        stock={stock}
        onOpenFinancial={() => {}}
        strokes={[]}
        onStrokesChange={() => {}}
        tradingOpen
        remainingMs={DURATION * 0.1}
        durationMs={DURATION}
        round={3}
        roundYearMap={roundYearMap}
        timerState="live"
      />,
    )
    const cxLate = Number(late.container.querySelector('.nowline-pulse').getAttribute('cx'))
    expect(cxEarly).toBe(cxLate)
    expect(cxEarly).toBeCloseTo(600 - 66, 5) // w - PAD.r
  })

  it('가격선의 마지막 점·펄스 점·기준선(y1/y2)이 항상 같은 y좌표를 공유한다(어긋남 없음)', () => {
    const { container } = render(
      <Chart
        stock={stock}
        onOpenFinancial={() => {}}
        strokes={[]}
        onStrokesChange={() => {}}
        tradingOpen
        remainingMs={DURATION * 0.3}
        durationMs={DURATION}
        round={3}
        roundYearMap={roundYearMap}
        timerState="live"
      />,
    )
    const pts = container.querySelector('.price-line').getAttribute('points').trim().split(/\s+/)
    const [, lineTipY] = pts[pts.length - 1].split(',').map(Number)
    const pulseCy = Number(container.querySelector('.nowline-pulse').getAttribute('cy'))
    const nowlineY1 = Number(container.querySelector('.nowline').getAttribute('y1'))
    expect(pulseCy).toBeCloseTo(lineTipY, 5)
    expect(nowlineY1).toBeCloseTo(lineTipY, 5)
  })

  it('가격선과 그라디언트 음영의 우측 끝 좌표가 정확히 일치한다(찢김 없음)', () => {
    const { container } = render(
      <Chart
        stock={stock}
        onOpenFinancial={() => {}}
        strokes={[]}
        onStrokesChange={() => {}}
        tradingOpen
        remainingMs={DURATION * 0.3}
        durationMs={DURATION}
        round={3}
        roundYearMap={roundYearMap}
        timerState="live"
      />,
    )
    const pts = container.querySelector('.price-line').getAttribute('points').trim().split(/\s+/)
    const lineTip = pts[pts.length - 1]
    const fillD = container.querySelector('.price-fill').getAttribute('d')
    expect(fillD.includes(`L${lineTip}`) || fillD.startsWith(`M${lineTip}`)).toBe(true)
  })

  it('[스냅 방지] 라이브 구간에서 이미 잠긴 점은 벽시계가 흘러도 값이 안 바뀐다 — 팁만 계속 움직인다', () => {
    // remainingMs(=reveal 진행률)는 고정한 채 실제 시각(Date.now())만 흘려서, "지나간 점이
    // 잠긴 순간의 잔떨림 값 그대로 얼어붙는지"만 따로 검증한다 — 매 렌더마다 팁만 움직이고
    // 그 앞의 이미 드러난 점들은 절대 값이 바뀌면 안 된다(바뀌면 "떨리다 스냅"이 재현된 것).
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000_000)
      const props = {
        stock,
        onOpenFinancial: () => {},
        strokes: [],
        onStrokesChange: () => {},
        tradingOpen: true,
        remainingMs: DURATION * 0.7,
        durationMs: DURATION,
        round: 3,
        roundYearMap,
        timerState: 'live',
      }
      const { container, rerender } = render(<Chart {...props} />)
      const before = container.querySelector('.price-line').getAttribute('points').trim().split(/\s+/)

      // SUB_TICK_INTERVAL_MS(1초)보다 짧게 흘려야 새 틱 경계를 안 넘는다 — 여기선 순수하게
      // "이미 잠긴 점이 안 튀는지"만 보고, 새 틱이 드러나는 것 자체는 다른 테스트가 검증한다.
      vi.setSystemTime(1_000_000 + 300) // remainingMs는 그대로 — 벽시계만 0.3초 흐름
      rerender(<Chart {...props} />)
      const after = container.querySelector('.price-line').getAttribute('points').trim().split(/\s+/)

      expect(before.length).toBe(after.length)
      expect(before.length).toBeGreaterThan(1)
      for (let i = 0; i < before.length - 1; i++) {
        expect(after[i]).toBe(before[i]) // 잠긴 점 — 완전히 동일해야 한다
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('durationMs·roundYearMap이 없어도(정보 없음) 죽지 않는다', () => {
    const { container } = render(
      <Chart stock={stock} onOpenFinancial={() => {}} strokes={[]} onStrokesChange={() => {}} tradingOpen remainingMs={90_000} round={3} />,
    )
    expect(container.querySelector('.price-line')).not.toBeNull()
  })

  it('대회 시작 전(확정 라운드 가격이 없음)이어도 현재가 하나로 안전하게 대체된다', () => {
    const notStarted = { ...stock, prices: {} }
    const { container } = render(
      <Chart
        stock={notStarted}
        onOpenFinancial={() => {}}
        strokes={[]}
        onStrokesChange={() => {}}
        tradingOpen={false}
        round={0}
        roundYearMap={roundYearMap}
        timerState={null}
      />,
    )
    expect(container.querySelector('.now').textContent).toBe('10,000')
  })
})

describe('그라디언트 음영', () => {
  it('가격선 아래 그라디언트 음영 경로가 NaN 없이 그려진다', () => {
    const { container } = render(
      <Chart
        stock={stock}
        onOpenFinancial={() => {}}
        strokes={[]}
        onStrokesChange={() => {}}
        tradingOpen={false}
        round={3}
        roundYearMap={roundYearMap}
        timerState="closed"
      />,
    )
    const fill = container.querySelector('.price-fill')
    expect(fill).not.toBeNull()
    expect(fill.getAttribute('d')).not.toMatch(/NaN/)
  })
})
