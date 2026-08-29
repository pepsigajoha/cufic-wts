import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import StockList from './StockList'

afterEach(cleanup)

// price/delta는 prevPrice=price-delta 기준으로 chg와 딱 맞아떨어지게 잡았다(10,500-500=10,000 → +5.00%).
const stocks = [
  { code: 'S01', name: '테스트전자', price: 10_500, delta: 500, chg: 5, halted: false, holding: 0 },
  { code: 'S02', name: '테스트항공', price: 7_600, delta: -400, chg: -5, halted: false, holding: 0 },
  { code: 'S03', name: '정지종목', price: 0, delta: 0, chg: 0, halted: true, holding: 0 },
]

describe('실시간 틱 연출 — [사용자가 규칙 무시하고 명시적으로 요청한 예외] 화면 텍스트/색만 흔들린다', () => {
  it('거래 시간이 아니면 실제 가격·등락률 그대로 보여준다', () => {
    const { container } = render(<StockList stocks={stocks} selectedCode="S01" onSelect={() => {}} onOpenMy={() => {}} tradingOpen={false} />)
    const rows = [...container.querySelectorAll('.row')]
    expect(rows[0].querySelector('.price').textContent).toBe('10,500')
    expect(rows[0].querySelector('.chg').textContent).toBe('+5.00%')
  })

  it('거래 시간이면 화면 텍스트가 실시간 틱값으로 흔들려도 NaN/undefined가 새 나가지 않는다', () => {
    const { container } = render(
      <StockList stocks={stocks} selectedCode="S01" onSelect={() => {}} onOpenMy={() => {}} tradingOpen remainingMs={90_000} round={3} />,
    )
    const rows = [...container.querySelectorAll('.row')]
    expect(rows[0].querySelector('.price').textContent).not.toMatch(/NaN|undefined/)
    expect(rows[0].querySelector('.chg').textContent).not.toMatch(/NaN|undefined/)
  })

  it('거래정지 종목은 거래 시간과 무관하게 항상 거래정지 태그만 보여준다(흔들리지 않음)', () => {
    const { container } = render(
      <StockList stocks={stocks} selectedCode="S01" onSelect={() => {}} onOpenMy={() => {}} tradingOpen remainingMs={90_000} round={3} />,
    )
    const rows = [...container.querySelectorAll('.row')]
    expect(rows[2].querySelector('.halted-tag').textContent).toBe('거래정지')
    expect(rows[2].querySelector('.price')).toBeNull()
  })

  it('실시간 틱 연출과 무관하게 정렬 기준은 실제 등락률(s.chg)을 그대로 쓴다 — 목록이 흔들리며 재정렬되지 않는다', () => {
    const { container } = render(
      <StockList
        stocks={stocks}
        selectedCode="S01"
        onSelect={() => {}}
        onOpenMy={() => {}}
        tradingOpen
        remainingMs={90_000}
        round={3}
      />,
    )
    // 기본 정렬(등록 순서) 그대로 S01, S02, S03 순서를 유지해야 한다.
    const names = [...container.querySelectorAll('.nm')].map((el) => el.textContent)
    expect(names).toEqual(['테스트전자', '테스트항공', '정지종목'])
  })
})

describe('주간(5스텝) 기준 등락률 + 플래시', () => {
  // pricePath: 인덱스 = 스텝. step15~25 구간을 10,000 → 14,000 우상향.
  // step20: path[20]=12,000 / path[15]=10,000 → +20.00%
  const path = Array.from({ length: 252 }, (_, i) =>
    i <= 15 ? 10_000 : i <= 25 ? 10_000 + (i - 15) * 400 : 14_000,
  )
  const withPath = [
    { code: 'S01', name: '테스트전자', price: 12_000, delta: 0, chg: 0, halted: false, holding: 0, pricePath: path },
  ]

  it('거래 중 등락률은 (현재가 − 5스텝 전 가격) / 5스텝 전 가격', () => {
    const { container } = render(
      <StockList stocks={withPath} selectedCode="S01" onSelect={() => {}} onOpenMy={() => {}} tradingOpen stepIndex={20} />,
    )
    expect(container.querySelector('.price').textContent).toBe('12,000') // path[20]
    expect(container.querySelector('.chg').textContent).toBe('+20.00%') // (12000-10000)/10000
    expect(container.querySelector('.pr').className).toContain('up')
  })

  it('같은 주(5스텝) 안에서는 방향 클래스가 안 바뀐다 — 색이 매 스텝 뒤집히지 않는다', () => {
    // step 21~24 → 전부 week 4, 우상향 → dir='up' 고정
    const dirAt = (step) => {
      const { container, unmount } = render(
        <StockList stocks={withPath} selectedCode="S01" onSelect={() => {}} onOpenMy={() => {}} tradingOpen stepIndex={step} />,
      )
      const cls = container.querySelector('.pr').className
      unmount()
      return cls
    }
    expect(dirAt(21)).toBe(dirAt(24))
    expect(dirAt(21)).toContain('up')
    expect(dirAt(21)).toContain('wk-flash')
  })

  it('비거래 중엔 연간(YoY) 등락률 s.chg를 그대로 쓴다', () => {
    const yoy = [{ code: 'S01', name: 'x', price: 10_500, delta: 500, chg: 5, halted: false, holding: 0, pricePath: path }]
    const { container } = render(
      <StockList stocks={yoy} selectedCode="S01" onSelect={() => {}} onOpenMy={() => {}} tradingOpen={false} stepIndex={100} />,
    )
    expect(container.querySelector('.chg').textContent).toBe('+5.00%')
    expect(container.querySelector('.pr').className).not.toContain('wk-flash')
  })
})
