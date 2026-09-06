import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OrderSheet from './OrderSheet'

afterEach(cleanup)

// unit = execPrice(>0) 우선. buyable = floor(cash / unit).
const base = {
  stock: { code: 'S01', name: '테스트전자', price: 100_000, halted: false, holding: 0, avgPrice: 0 },
  execPrice: 100_000,
  stepIndex: 251,
  cash: 1_000_000,
  stocks: [{ code: 'S01', name: '테스트전자', price: 100_000, halted: false, holding: 0, avgPrice: 0 }],
  placing: false,
  tradingOpen: true,
  started: true,
  ended: false,
  hasTraded: true,
  onSelectStock: () => {},
  onNotify: () => {},
}

describe('OrderSheet — 위험 주문 확인(UX 계층)', () => {
  it('평가금액의 70% 미만 주문은 확인 없이 바로 체결한다', async () => {
    const u = userEvent.setup()
    const onOrder = vi.fn()
    render(<OrderSheet {...base} onOrder={onOrder} />)
    // 10% → 1주(10만) = equity 100만의 10%
    await u.click(screen.getByRole('button', { name: '10%' }))
    await u.click(screen.getByRole('button', { name: '매수' }))
    expect(onOrder).toHaveBeenCalledWith('buy', 1)
    expect(screen.queryByRole('dialog', { name: '주문 확인' })).not.toBeInTheDocument()
  })

  it('평가금액의 70% 이상 주문은 확인 모달을 먼저 띄우고, 확인해야 체결한다', async () => {
    const u = userEvent.setup()
    const onOrder = vi.fn()
    render(<OrderSheet {...base} onOrder={onOrder} />)
    // 최대 → 10주(100만) = equity의 100%
    await u.click(screen.getByRole('button', { name: '최대' }))
    await u.click(screen.getByRole('button', { name: '매수' }))
    expect(onOrder).not.toHaveBeenCalled()
    const dlg = screen.getByRole('dialog', { name: '주문 확인' })
    expect(within(dlg).getByText(/평가금액의/)).toBeInTheDocument()
    await u.click(within(dlg).getByRole('button', { name: '매수' }))
    expect(onOrder).toHaveBeenCalledWith('buy', 10)
  })

  it('확인 모달에서 취소하면 체결하지 않는다', async () => {
    const u = userEvent.setup()
    const onOrder = vi.fn()
    render(<OrderSheet {...base} onOrder={onOrder} />)
    await u.click(screen.getByRole('button', { name: '최대' }))
    await u.click(screen.getByRole('button', { name: '매수' }))
    await u.click(screen.getByRole('button', { name: '취소' }))
    expect(onOrder).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: '주문 확인' })).not.toBeInTheDocument()
  })

  it('보유 종목이면 매수 탭에서도 보유·평단·평가손익 박스를 보여준다', () => {
    const held = {
      ...base,
      stock: { code: 'S01', name: '테스트전자', price: 120_000, halted: false, holding: 5, avgPrice: 100_000 },
    }
    const { container } = render(<OrderSheet {...held} onOrder={vi.fn()} />)
    // 기본 탭 = 매수. posbox가 매수 탭에도 렌더돼야 한다(옛날엔 매도 탭 전용).
    const posbox = container.querySelector('.posbox')
    expect(posbox).toBeInTheDocument()
    expect(posbox).toHaveTextContent('보유')
    expect(posbox).toHaveTextContent('평균단가')
    expect(posbox).toHaveTextContent('평가손익')
  })
})
