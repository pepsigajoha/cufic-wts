// 계좌 요약 계산. 화면에 보이는 금액은 전부 여기서 파생된다.

/** 보유종목 평가액 합계 */
const holdingsValue = (stocks) => stocks.reduce((sum, s) => sum + s.holding * s.price, 0)

/**
 * 평가금액 = 예수금 + Σ(보유수량 × 현재가) + 예금 잔액
 * 총 손익  = 평가금액 - 원금
 *
 * [예금을 반드시 더한다] 예금에 넣은 돈은 teams.cash에서 빠지지만 사라진 게 아니다.
 * 서버 team_equity()가 활성 예금 잔액을 더하므로(마이그레이션 0040), 여기서 빼먹으면
 * 학생 화면의 평가금액만 예금액만큼 줄어 보이고 리더보드와 어긋난다 —
 * "예금 넣었더니 내 돈이 사라졌다"로 보인다.
 *
 * @param {number} savings  활성 예금 잔액 합계(user_savings.balance). 예금 없으면 0.
 */
export function deriveAccount(stocks, cash, principal, savings = 0) {
  const holdings = holdingsValue(stocks)
  const equity = cash + holdings + savings
  const pnl = equity - principal
  return {
    equity,
    cash,
    holdings,
    savings,
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
