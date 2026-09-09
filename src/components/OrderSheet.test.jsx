import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OrderSheet from './OrderSheet'

vi.mock('../supabase', () => ({ errorText: (code) => `ERR:${code}` }))

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


describe('주문 가격과 실패 복구', () => {
  it('단일가 모드에서는 장중 가격과 달라도 종가로 최대수량과 주문금액을 계산한다', async () => {
    const u = userEvent.setup()
    render(<OrderSheet {...base} flatPricing execPrice={50_000} onOrder={vi.fn()} />)
    expect(screen.getByText('주문가능 10주')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: '최대' }))
    expect(screen.getByLabelText('매수 수량')).toHaveValue('10')
    await u.click(screen.getByRole('button', { name: '매수' }))
    expect(within(screen.getByRole('dialog')).getByText('₩ 1,000,000')).toBeInTheDocument()
  })

  it('실패하면 수량과 오류가 남고 재시도 성공 후에만 초기화한다', async () => {
    const u = userEvent.setup()
    const onOrder = vi.fn().mockResolvedValueOnce({ ok: false, error: 'network' }).mockResolvedValueOnce({ ok: true })
    render(<OrderSheet {...base} onOrder={onOrder} />)
    await u.click(screen.getByRole('button', { name: '10%' }))
    await u.click(screen.getByRole('button', { name: '매수' }))
    expect(screen.getByLabelText('매수 수량')).toHaveValue('1')
    expect(screen.getByRole('alert')).toHaveTextContent('ERR:network')
    await u.click(screen.getByRole('button', { name: '매수' }))
    expect(onOrder).toHaveBeenLastCalledWith('buy', 1)
    expect(screen.getByLabelText('매수 수량')).toHaveValue('0')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
