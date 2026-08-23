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
