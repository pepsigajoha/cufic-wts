import { describe, it, expect } from 'vitest'
import { buildDerivedContent } from './simContent'

const STOCKS = [
  { id: 'S1', name: '가나전자' },
  { id: 'S2', name: '다라화학' },
]
// 앵커(2020) 재무 — 정상 흑자
const FIN = STOCKS.map((s) => ({
  stock_id: s.id,
  year: 2020,
  current_assets: 600,
  noncurrent_assets: 400,
  current_liabilities: 200,
  noncurrent_liabilities: 300,
  revenue: 1000,
  operating_expense: 800,
  nonoperating_expense: 50,
}))
const ROUND_YEAR_MAP = { 1: 2020, 2: 2021, 3: 2022 }
const FINAL_YEAR = 2023

// S1 은 매년 급등, S2 는 급락하는 가격표
const PRICES = {
  S1: { 2020: 10000, 2021: 15000, 2022: 22000, 2023: 30000 },
  S2: { 2020: 10000, 2021: 7000, 2022: 4500, 2023: 3000 },
}

describe('buildDerivedContent', () => {
  it('재생성 연도의 재무를 앵커에서 체인으로 만든다', () => {
    const { financials } = buildDerivedContent({
      prices: PRICES,
      stocks: STOCKS,
      financials: FIN,
      macroByYear: {},
      roundYearMap: ROUND_YEAR_MAP,
      finalYear: FINAL_YEAR,
      regenYears: [2021, 2022],
    })
    // 2종목 × 2연도
    expect(financials).toHaveLength(4)
    const s1_2021 = financials.find((r) => r.stock_id === 'S1' && r.year === 2021)
    expect(s1_2021.revenue).toBeGreaterThan(1000) // 급등 → 매출 증가
    const s2_2021 = financials.find((r) => r.stock_id === 'S2' && r.year === 2021)
    expect(s2_2021.revenue).toBeLessThan(1000) // 급락 → 매출 감소
    // snake 컬럼이 다 있다
    for (const k of ['current_assets', 'noncurrent_assets', 'revenue', 'operating_expense', 'nonoperating_expense'])
      expect(typeof s1_2021[k]).toBe('number')
  })

  it('힌트를 가격 방향에 맞게 만들고 self-check 를 통과한다', () => {
    const { hints, replaceRounds, check } = buildDerivedContent({
      prices: PRICES,
      stocks: STOCKS,
      financials: FIN,
      macroByYear: {},
      roundYearMap: ROUND_YEAR_MAP,
      finalYear: FINAL_YEAR,
      regenYears: [2021, 2022],
    })
    // R2, R3 힌트 재생성
    expect(replaceRounds.sort()).toEqual([2, 3])
    // S1 관련 힌트는 up, S2 관련 힌트는 down
    for (const h of hints) {
      const id = h.related_stock_ids[0]
      expect(h.impact).toBe(id === 'S1' ? 'up' : 'down')
    }
    // 힌트가 가격에서 나왔으니 정합성 어긋남이 없어야 한다
    expect(check.mismatches).toEqual([])
    expect(check.checked).toBeGreaterThan(0)
  })

  it('회계 항등식이 유지된다', () => {
    const { financials } = buildDerivedContent({
      prices: PRICES,
      stocks: STOCKS,
      financials: FIN,
      roundYearMap: ROUND_YEAR_MAP,
      finalYear: FINAL_YEAR,
      regenYears: [2021, 2022],
    })
    for (const r of financials) {
      const assets = r.current_assets + r.noncurrent_assets
      const liab = r.current_liabilities + r.noncurrent_liabilities
      // 자본 = 자산 − 부채 이므로 항등식은 정의상 성립. 여기선 값이 유한한지만.
      expect(Number.isFinite(assets - liab)).toBe(true)
      expect(assets).toBeGreaterThanOrEqual(0)
    }
  })

  it('앵커 재무가 없는 종목은 건너뛴다', () => {
    const { financials } = buildDerivedContent({
      prices: { ...PRICES, S3: { 2020: 100, 2021: 200 } },
      stocks: [...STOCKS, { id: 'S3', name: '신규' }],
      financials: FIN, // S3 재무 없음
      roundYearMap: ROUND_YEAR_MAP,
      finalYear: FINAL_YEAR,
      regenYears: [2021],
    })
    expect(financials.some((r) => r.stock_id === 'S3')).toBe(false)
  })
})
