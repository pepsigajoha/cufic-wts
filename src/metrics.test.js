import { describe, it, expect } from 'vitest'
import { deriveFinancials, deriveNextFinancials, FIN_INPUTS } from './metrics'

// 정상 흑자 기업 한 해치 (억원). 파생: 자산 1000·부채 500·자본 500·영업이익 200·당기순이익 150·ROE 30%
const BASE = {
  currentAssets: 600,
  noncurrentAssets: 400,
  currentLiabilities: 200,
  noncurrentLiabilities: 300,
  revenue: 1000,
  operatingExpense: 800,
  nonoperatingExpense: 50,
}
const KEYS = FIN_INPUTS.map((m) => m.key)
const next = (prev, ctx) => deriveNextFinancials(prev, ctx)
const ni = (prev, ctx) => deriveFinancials(next(prev, ctx)).netIncome

describe('deriveNextFinancials', () => {
  it('prev 가 null 이면 null', () => {
    expect(deriveNextFinancials(null, { priceReturn: 0.3 })).toBeNull()
  })

  it('입력 7개가 전부 음수 아닌 정수 (극단 수익률 포함)', () => {
    for (const r of [-0.99, -0.5, 0, 0.3, 3.0]) {
      const f = next(BASE, { priceReturn: r })
      for (const k of KEYS) {
        expect(Number.isInteger(f[k]), `${k} @r=${r}`).toBe(true)
        expect(f[k], `${k} @r=${r}`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('회계 항등식이 성립한다 (자산 = 부채 + 자본)', () => {
    for (const r of [-0.6, 0, 0.5, 2.0]) {
      const d = deriveFinancials(next(BASE, { priceReturn: r }))
      expect(d.assets, `@r=${r}`).toBe(d.liabilities + d.equity)
    }
  })

  it('가격이 오르면 당기순이익·ROE가 개선되고, 내리면 악화된다', () => {
    const up = deriveFinancials(next(BASE, { priceReturn: 0.5 }))
    const flat = deriveFinancials(next(BASE, { priceReturn: 0 }))
    const down = deriveFinancials(next(BASE, { priceReturn: -0.5 }))
    expect(up.netIncome).toBeGreaterThan(flat.netIncome)
    expect(flat.netIncome).toBeGreaterThan(down.netIncome)
    expect(up.roe).toBeGreaterThan(down.roe)
  })

  it('수익률이 클수록 당기순이익이 단조 증가한다 (정상 흑자 기업)', () => {
    const seq = [-0.5, -0.2, 0, 0.2, 0.5, 1.0].map((r) => ni(BASE, { priceReturn: r }))
    for (let i = 1; i < seq.length; i++) expect(seq[i], `step ${i}`).toBeGreaterThan(seq[i - 1])
  })

  it('폭락이 이어지면 자본잠식(impaired)에 이른다', () => {
    let f = BASE
    for (let y = 0; y < 4; y++) f = next(f, { priceReturn: -0.9 })
    expect(deriveFinancials(f).impaired).toBe(true)
  })

  it('한 해 폭락은 당기순이익을 적자로 만든다', () => {
    expect(ni(BASE, { priceReturn: -0.8 })).toBeLessThan(0)
  })

  it('기준금리가 오르면 영업외비용(이자)이 늘어난다', () => {
    const same = next(BASE, { priceReturn: 0, macroPrev: { rate: 2 }, macroNext: { rate: 2 } })
    const hike = next(BASE, { priceReturn: 0, macroPrev: { rate: 2 }, macroNext: { rate: 5 } })
    expect(hike.nonoperatingExpense).toBeGreaterThan(same.nonoperatingExpense)
  })

  it('물가상승률이 명목 매출을 끌어올린다', () => {
    const base = next(BASE, { priceReturn: 0 })
    const withInfl = next(BASE, { priceReturn: 0, macroNext: { cpi: 5 } })
    expect(withInfl.revenue).toBeGreaterThan(base.revenue)
  })

  it('수익률 0·시황 없음이면 실적이 크게 튀지 않는다 (±5% 이내)', () => {
    const f = deriveFinancials(next(BASE, { priceReturn: 0 }))
    const base = deriveFinancials(BASE)
    expect(Math.abs(f.revenue / base.revenue - 1)).toBeLessThan(0.05)
    expect(Math.abs(f.operatingIncome / base.operatingIncome - 1)).toBeLessThan(0.05)
  })
})
