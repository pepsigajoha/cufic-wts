import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Savings from './Savings'

vi.mock('../supabase', () => ({ errorText: (code) => `ERR:${code}` }))
afterEach(cleanup)
const base = {
  savings: [{ id: 1, principal: 100_000, balance: 110_001, start_round: 1 }],
  rate: 3, cash: 1_000_000, round: 2, roundYearMap: { 1: 2020, 2: 2021 }, macro: {},
  started: true, ended: false, busy: false,
}

describe('예금 입력 복구와 해지 확인', () => {
  it('가입 실패 시 금액을 보존하고 성공할 때만 비운다', async () => {
    const u = userEvent.setup()
    const onOpen = vi.fn().mockResolvedValueOnce({ ok: false, error: 'network' }).mockResolvedValueOnce({ ok: true })
    render(<Savings {...base} onOpen={onOpen} onWithdraw={vi.fn()} />)
    await u.type(screen.getByLabelText('예치 금액'), '50000')
    await u.click(screen.getByRole('button', { name: '예금 가입' }))
    expect(screen.getByLabelText('예치 금액')).toHaveValue(50000)
    expect(screen.getByRole('alert')).toHaveTextContent('ERR:network')
    await u.click(screen.getByRole('button', { name: '예금 가입' }))
    expect(onOpen).toHaveBeenLastCalledWith(50000)
    expect(screen.getByLabelText('예치 금액')).toHaveValue(null)
  })

  it('수령액·소멸 이자를 서버와 같은 반올림으로 표시하고 취소하면 해지하지 않는다', async () => {
    const u = userEvent.setup()
    const onWithdraw = vi.fn()
    render(<Savings {...base} onOpen={vi.fn()} onWithdraw={onWithdraw} />)
    await u.click(screen.getByRole('button', { name: '해지', exact: true }))
    const dialog = screen.getByRole('dialog', { name: '예금 해지 확인' })
    expect(within(dialog).getByText('₩ 105,001')).toBeInTheDocument()
    expect(within(dialog).getByText('₩ 5,000')).toBeInTheDocument()
    expect(onWithdraw).not.toHaveBeenCalled()
    await u.click(within(dialog).getByRole('button', { name: '취소' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onWithdraw).not.toHaveBeenCalled()
  })

  it('해지 실패 시 확인창이 남아 재시도할 수 있다', async () => {
    const u = userEvent.setup()
    const onWithdraw = vi.fn().mockResolvedValueOnce({ ok: false, error: 'network' }).mockResolvedValueOnce({ ok: true })
    render(<Savings {...base} onOpen={vi.fn()} onWithdraw={onWithdraw} />)
    await u.click(screen.getByRole('button', { name: '해지', exact: true }))
    await u.click(screen.getByRole('button', { name: '해지하기' }))
    expect(screen.getByRole('alert')).toHaveTextContent('ERR:network')
    await u.click(screen.getByRole('button', { name: '해지하기' }))
    expect(onWithdraw).toHaveBeenLastCalledWith(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
