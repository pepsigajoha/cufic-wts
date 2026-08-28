import { describe, it, expect } from 'vitest'
import { deriveAccount, positionPnl } from './account'

// 화면에 보이는 모든 금액이 여기서 나온다. 서버로 옮겨가도 이 규칙은 그대로여야 한다.
//   평가금액 = 예수금 + Σ(보유수량 × 현재가)
//   총 손익  = 평가금액 - 원금

const PRINCIPAL = 100_000_000
const stock = (over = {}) => ({ price: 50_000, holding: 0, avgPrice: 0, ...over })

describe('deriveAccount — 평가금액 파생', () => {
  it('거래 전에는 예수금이 곧 평가금액이고 손익은 0이다', () => {
    const a = deriveAccount([stock(), stock()], PRINCIPAL, PRINCIPAL)
    expect(a.equity).toBe(PRINCIPAL)
    expect(a.pnl).toBe(0)
    expect(a.pnlPct).toBe(0)
  })

  it('평가금액 = 예수금 + Σ(보유수량 × 현재가)', () => {
    const stocks = [
      stock({ price: 74_200, holding: 100 }), // 7,420,000
      stock({ price: 41_850, holding: 200 }), // 8,370,000
      stock({ price: 10_000, holding: 0 }), //          0
    ]
    const a = deriveAccount(stocks, 5_000_000, PRINCIPAL)
    expect(a.equity).toBe(5_000_000 + 7_420_000 + 8_370_000)
  })

  it('현재가로 사면 평가금액이 변하지 않는다 (현금 ↔ 주식 교환일 뿐)', () => {
    const before = deriveAccount([stock({ price: 55_300, holding: 0 })], PRINCIPAL, PRINCIPAL)
    // 100주를 55,300에 매수 → 예수금 -5,530,000, 보유 +100
    const after = deriveAccount(
      [stock({ price: 55_300, holding: 100, avgPrice: 55_300 })],
      PRINCIPAL - 5_530_000,
      PRINCIPAL,
    )
    expect(after.equity).toBe(before.equity)
    expect(after.pnl).toBe(0)
  })

  it('주가가 오르면 그만큼 손익이 생긴다', () => {
    // 55,300에 산 100주가 78,500이 됨 → +2,320,000
    const a = deriveAccount(
      [stock({ price: 78_500, holding: 100, avgPrice: 55_300 })],
      PRINCIPAL - 5_530_000,
      PRINCIPAL,
    )
    expect(a.pnl).toBe(2_320_000)
    expect(a.pnlPct).toBeCloseTo(2.32, 5)
  })

  it('거래정지(가격 0) 종목은 평가액 0으로 잡혀 전액 손실이 된다', () => {
    const a = deriveAccount(
      [stock({ price: 0, holding: 100, avgPrice: 55_300 })],
      PRINCIPAL - 5_530_000,
      PRINCIPAL,
    )
    expect(a.equity).toBe(PRINCIPAL - 5_530_000)
    expect(a.pnl).toBe(-5_530_000)
  })

  it('원금이 0이어도 나누기 오류 없이 0%를 낸다', () => {
    expect(deriveAccount([], 0, 0).pnlPct).toBe(0)
  })
})

describe('positionPnl — 종목별 평가손익', () => {
  it('평가손익 = (현재가 - 평균단가) × 보유수량', () => {
    const p = positionPnl(stock({ price: 74_200, holding: 45, avgPrice: 68_500 }))
    expect(p.pnl).toBe(45 * (74_200 - 68_500))
    expect(p.pnlPct).toBeCloseTo(8.32, 2)
  })

  it('손실이면 음수로 나온다', () => {
    const p = positionPnl(stock({ price: 41_850, holding: 6, avgPrice: 45_200 }))
    expect(p.pnl).toBe(6 * (41_850 - 45_200))
    expect(p.pnlPct).toBeCloseTo(-7.41, 2)
  })

  it('보유가 없으면 0이고 0으로 나누지 않는다', () => {
    const p = positionPnl(stock({ holding: 0, avgPrice: 0 }))
    expect(p.pnl).toBe(0)
    expect(p.pnlPct).toBe(0)
  })

  it('거래정지 종목은 -100%가 된다', () => {
    const p = positionPnl(stock({ price: 0, holding: 100, avgPrice: 55_300 }))
    expect(p.pnl).toBe(-5_530_000)
    expect(p.pnlPct).toBe(-100)
  })
})
