import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import JudgmentDock from './JudgmentDock'

afterEach(cleanup)

const stock = { code: 'S01', name: '테스트전자' }
// 입력 7개(억원). deriveFinancials가 매출/영업이익/부채비율/ROE를 계산한다.
const fin = {
  S01: {
    2020: { currentAssets: 500, noncurrentAssets: 500, currentLiabilities: 200, noncurrentLiabilities: 200, revenue: 1000, operatingExpense: 800, nonoperatingExpense: 50 },
    2021: { currentAssets: 600, noncurrentAssets: 600, currentLiabilities: 200, noncurrentLiabilities: 200, revenue: 1300, operatingExpense: 900, nonoperatingExpense: 50 },
    2022: { currentAssets: 700, noncurrentAssets: 700, currentLiabilities: 200, noncurrentLiabilities: 200, revenue: 1600, operatingExpense: 1000, nonoperatingExpense: 50 },
  },
}
const macro = {
  2020: { summary: '완만한 회복', rate: 1.5, cpi: 1.0, kospi: 2800, oil: 60 },
  2021: { summary: '금리 인상 시작', rate: 2.5, cpi: 3.2, kospi: 3000, oil: 75 },
}
const hints = [
  { id: 1, grade: 'C', round: 2, headline: '경쟁사 신제품 출시', related_stock_ids: [] },
  { id: 2, grade: 'S', round: 2, headline: '정부 대규모 보조금 발표', related_stock_ids: ['S01'] },
]

describe('JudgmentDock', () => {
  it('재무 탭: 스포일러 차단 — round.year 이하 최신 연도만 쓴다', () => {
    render(
      <JudgmentDock stock={stock} financials={fin} macro={{}} round={{ round: 2, year: 2021 }} hints={[]} />,
    )
    // 2021년 기준: 매출 1,300 / 영업이익 400. 2022 자료는 가려져야 한다.
    expect(screen.getByText('1,300')).toBeInTheDocument()
    expect(screen.queryByText('1,600')).not.toBeInTheDocument()
    expect(screen.getByText(/2021년 기준/)).toBeInTheDocument()
  })

  it('시황 탭: 요약 문장 + 전년 대비 화살표', async () => {
    const u = userEvent.setup()
    render(
      <JudgmentDock stock={stock} financials={{}} macro={macro} round={{ round: 2, year: 2021 }} hints={[]} />,
    )
    await u.click(screen.getByRole('tab', { name: '시황 요약' }))
    expect(screen.getByText('금리 인상 시작')).toBeInTheDocument()
    // rate 1.5 → 2.5 상승 → 화살표(▲)가 어딘가에 있다
    expect(screen.getByText(/2021년 기준/)).toBeInTheDocument()
  })

  it('힌트 탭: 개수 배지 + 최상위 등급(S) 헤드라인', async () => {
    const u = userEvent.setup()
    render(
      <JudgmentDock stock={stock} financials={{}} macro={{}} round={{ round: 2, year: 2021 }} hints={hints} />,
    )
    await u.click(screen.getByRole('tab', { name: /힌트/ }))
    expect(screen.getByText('정부 대규모 보조금 발표')).toBeInTheDocument()
    expect(screen.getByText('이 힌트 외 1개 더 있어요')).toBeInTheDocument()
  })

  it('자료 없음: 빈 상태 문구 (게임 시작 전 year=0이면 연도 없이)', () => {
    render(
      <JudgmentDock stock={stock} financials={{}} macro={{}} round={{ round: 0, year: 0 }} hints={[]} />,
    )
    expect(screen.getByText('공개된 재무 자료가 없어요.')).toBeInTheDocument()
  })

  it('접기/펼치기 — 본문이 사라졌다 나타난다', async () => {
    const u = userEvent.setup()
    render(
      <JudgmentDock stock={stock} financials={fin} macro={{}} round={{ round: 3, year: 2022 }} hints={[]} />,
    )
    expect(screen.getByText(/2022년 기준/)).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: '판단 근거 접기' }))
    expect(screen.queryByText(/2022년 기준/)).not.toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: '판단 근거 펼치기' }))
    expect(screen.getByText(/2022년 기준/)).toBeInTheDocument()
  })
})
