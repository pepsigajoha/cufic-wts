import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FloatingRoundDock from './FloatingRoundDock'

// AdminSimulator.test.jsx와 동일한 이유 — ../supabase는 .env 없이 import되면 모듈 로드
// 시점에 예외를 던진다(Supabase 클라이언트 생성). 원격 접속 없이 테스트하려고 대역으로 바꾼다.
vi.mock('../supabase', () => ({
  errorText: (code) => `ERR:${code}`,
}))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function makeProps(overrides = {}) {
  return {
    game: {
      current_round: 1,
      total_rounds: 5,
      round_year_map: { 1: 2021, 2: 2022, 3: 2023, 4: 2024, 5: 2025 },
      final_year: 2026,
      round_ends_at: null,
      is_locked: false,
    },
    stocks: [
      { id: 'A001', name: '테스트전자', sector: 'Tech', prices: { 2021: 10000 } },
      { id: 'A002', name: '테스트항공', sector: 'Air', prices: { 2021: 8000 } },
    ],
    actions: {
      advanceRound: vi.fn(async () => ({ ok: true, current_round: 2 })),
      startTimer: vi.fn(async () => ({ ok: true })),
      saveDataset: vi.fn(async () => ({ ok: true, id: 1 })),
      applySimulatedPrices: vi.fn(async () => ({ ok: true, applied: 2 })),
      sendBroadcast: vi.fn(async () => ({ ok: true, id: 1 })),
    },
    notify: vi.fn(),
    refresh: vi.fn(async () => {}),
    onNavigate: vi.fn(),
    ...overrides,
  }
}

const openDock = async (u) => u.click(screen.getByLabelText('빠른 진행 패널 열기'))

describe('FloatingRoundDock 마운트', () => {
  it('접힌 상태로 라운드 뱃지(R1/5)가 항상 보인다', () => {
    render(<FloatingRoundDock {...makeProps()} />)
    expect(screen.getByText('R1/5')).toBeInTheDocument()
  })

  it('펼치면 라운드 진행·타이머 재시작·주가 생성기 바로가기 버튼이 나타난다', async () => {
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<FloatingRoundDock {...makeProps()} />)
    await openDock(u)

    expect(screen.getByText('Round 1 / 5')).toBeInTheDocument()
    expect(screen.getByText('▶ 다음 라운드 진행')).toBeInTheDocument()
    expect(screen.getByText('⏱ 타이머 재시작')).toBeInTheDocument()
    expect(screen.getByText('🧮 주가 생성기 열기')).toBeInTheDocument()
  })
})

describe('타이머 카운트다운', () => {
  it('거래가 열려있으면(round_ends_at 미래) 남은 시간이 표시된다', async () => {
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const game = { ...makeProps().game, round_ends_at: new Date(Date.now() + 125_000).toISOString() }
    render(<FloatingRoundDock {...makeProps({ game })} />)
    await openDock(u)

    expect(screen.getByText(/⏱ 2:0\d 남음/)).toBeInTheDocument()
  })

  it('거래가 안 열려있으면(round_ends_at 없음) 남은 시간이 안 뜬다', async () => {
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<FloatingRoundDock {...makeProps()} />)
    await openDock(u)

    expect(screen.queryByText(/남음/)).not.toBeInTheDocument()
  })

  it('[⏱ 타이머 재시작] 클릭 시 startTimer가 호출된다', async () => {
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const props = makeProps()
    render(<FloatingRoundDock {...props} />)
    await openDock(u)
    await u.click(screen.getByText('⏱ 타이머 재시작'))

    expect(props.actions.startTimer).toHaveBeenCalledTimes(1)
    expect(props.refresh).toHaveBeenCalledTimes(1)
  })
})

describe('빠른 이동', () => {
  it('[🧮 주가 생성기 열기] 클릭 시 onNavigate("simulator")가 불린다', async () => {
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const props = makeProps()
    render(<FloatingRoundDock {...props} />)
    await openDock(u)
    await u.click(screen.getByText('🧮 주가 생성기 열기'))

    expect(props.onNavigate).toHaveBeenCalledWith('simulator')
  })
})

describe('원클릭 라운드 진행', () => {
  it('[▶ 다음 라운드 진행] → 확인 모달 → [진행] 클릭 시 advanceRound가 호출되고 갱신된다', async () => {
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const props = makeProps()
    render(<FloatingRoundDock {...props} />)
    await openDock(u)
    await u.click(screen.getByText('▶ 다음 라운드 진행'))

    expect(screen.getByText('다음 라운드로 진행')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: '진행' }))

    expect(props.actions.advanceRound).toHaveBeenCalledTimes(1)
    expect(props.refresh).toHaveBeenCalledTimes(1)
    expect(props.notify).toHaveBeenCalledWith(expect.stringContaining('R2'), 'gold')
  })

  it('취소를 누르면 advanceRound를 호출하지 않는다', async () => {
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const props = makeProps()
    render(<FloatingRoundDock {...props} />)
    await openDock(u)
    await u.click(screen.getByText('▶ 다음 라운드 진행'))
    await u.click(screen.getByText('취소'))

    expect(props.actions.advanceRound).not.toHaveBeenCalled()
  })

  it('대회가 끝났으면(current_round > total_rounds) 진행 버튼이 비활성화된다', async () => {
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<FloatingRoundDock {...makeProps({ game: { ...makeProps().game, current_round: 6 } })} />)
    await openDock(u)
    expect(screen.getByText('▶ 다음 라운드 진행')).toBeDisabled()
    expect(screen.getByText('대회 종료')).toBeInTheDocument()
  })
})

describe('⚡ 빠른 주가 생성', () => {
  it('진행 중인 라운드가 없으면 안내 문구만 뜨고 프리셋 버튼이 없다', async () => {
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<FloatingRoundDock {...makeProps({ game: { ...makeProps().game, current_round: 0 } })} />)
    await openDock(u)

    expect(screen.getByText('진행 중인 라운드가 없어요.')).toBeInTheDocument()
    expect(screen.queryByText('정상 성장')).not.toBeInTheDocument()
  })

  it('프리셋 클릭 시 다음 라운드 가격이 계산되고 결과 요약이 뜬다', async () => {
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<FloatingRoundDock {...makeProps()} />)
    await openDock(u)
    await u.click(screen.getByText('정상 성장'))

    expect(screen.getByText(/정상 성장 · 평균/)).toBeInTheDocument()
    expect(screen.getByText('이 결과로 적용 + 속보')).toBeInTheDocument()
  })

  it('[이 결과로 적용 + 속보] → 확인 → 백업·적용·속보 발행이 순서대로 불린다', async () => {
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const props = makeProps()
    render(<FloatingRoundDock {...props} />)
    await openDock(u)
    await u.click(screen.getByText('정상 성장'))
    await u.click(screen.getByText('이 결과로 적용 + 속보'))

    expect(screen.getByText('빠른 생성 결과 적용')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: '적용 + 발행' }))

    expect(props.actions.saveDataset).toHaveBeenCalledTimes(1)
    expect(props.actions.applySimulatedPrices).toHaveBeenCalledTimes(1)
    expect(props.actions.sendBroadcast).toHaveBeenCalledTimes(1)

    // admin_apply_simulated_prices는 stocks.prices를 통째로 교체한다(병합 아님) — 다음 연도만
    // 보내면 과거 연도가 사라져 전 종목이 거래정지로 먹통이 되는 회귀 버그였다.
    // 과거(2021) + 다음 연도(2022)를 전부 담아 보내야 한다.
    const payload = props.actions.applySimulatedPrices.mock.calls[0][0]
    expect(Object.keys(payload.A001).sort()).toEqual(['2021', '2022'])
    expect(payload.A001['2021']).toBe(10_000)
    expect(props.refresh).toHaveBeenCalledTimes(1)
  })
})
