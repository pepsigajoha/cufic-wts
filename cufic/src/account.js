// 계좌 요약 계산. 화면에 보이는 금액은 전부 여기서 파생된다.

/** 보유종목 평가액 합계 */
const holdingsValue = (stocks) => stocks.reduce((sum, s) => sum + s.holding * s.price, 0)

/**
 * 평가금액 = 예수금 + Σ(보유수량 × 현재가)
 * 총 손익  = 평가금액 - 원금
 */
export function deriveAccount(stocks, cash, principal) {
  const equity = cash + holdingsValue(stocks)
  const pnl = equity - principal
  return {
    equity,
    cash,
    pnl,
    pnlPct: principal ? (pnl / principal) * 100 : 0,
  }
}

/** 개별 종목 평가손익 */
export function positionPnl(stock) {
  const cost = stock.holding * stock.avgPrice
  const value = stock.holding * stock.price
  const pnl = value - cost
  return { cost, value, pnl, pnlPct: cost ? (pnl / cost) * 100 : 0 }
}
