import { useEffect, useMemo, useState } from 'react'
import { errorText } from '../supabase'
import { num } from '../format'
import QtyStepper from './QtyStepper'
import VolatilitySmileModal from './VolatilitySmileModal'

/**
 * 옵션(파생) 주문 패널 — 매수(롱) 전용. OrderSheet.jsx와 같은 즉시체결·서버판정 원칙.
 *
 * 프리미엄은 실시간 tick가 기준이라 화면에 보이는 값이 계속 바뀐다. 여기서는 3초마다
 * quote_option_premium을 다시 불러 보여주고, 실제 체결가는 place_option_order가 그 순간
 * 서버에서 다시 계산한다(견적은 참고용일 뿐 확정가가 아니다 — place_order와 동일한 원칙).
 *
 * @param {object} stock  선택된 종목(App.jsx buildStocks 결과 — holding·price 포함)
 * @param {object[]} contracts  전체 활성 옵션 계약(App.jsx에서 로드)
 * @param {number} currentRound  만기 지난 계약을 선택 목록에서 빼는 데 쓴다(자동상장으로 라운드마다
 *   계약이 쌓이므로 이게 없으면 죽은 계약이 계속 드롭다운에 남는다).
 * @param {number} cash
 * @param {boolean} tradingOpen
 * @param {boolean} placing
 * @param {(contractId:number) => Promise<{ok:boolean, premium_per_unit?:number}>} onQuote
 * @param {(contractId:number, qty:number) => Promise<void>} onOrder
 * @param {(contract:object|null, premiumPerUnit:number, qty:number) => void} [onQuoteChange]
 *   PayoffDiagram이 같은 계약·프리미엄·수량을 그리려면 부모(App.jsx)가 이 값을 알아야 한다.
 * @param {(msg:string, tone?:string) => void} [onNotify]
 */
export default function OptionOrderPanel({
  stock,
  contracts,
  currentRound,
  cash,
  tradingOpen,
  started,
  ended,
  placing,
  onQuote,
  onOrder,
  onQuoteChange,
  onNotify,
}) {
  const stockContracts = useMemo(
    () =>
      (contracts ?? []).filter(
        (c) => c.stock_id === stock?.code && c.active && c.expiry_round > (currentRound ?? 0),
      ),
    [contracts, stock, currentRound],
  )

  const [contractId, setContractId] = useState(null)
  useEffect(() => {
    setContractId((cur) => (stockContracts.some((c) => c.id === cur) ? cur : (stockContracts[0]?.id ?? null)))
  }, [stockContracts])

  const contract = stockContracts.find((c) => c.id === contractId) ?? null

  const [qty, setQty] = useState(0)
  const [orderError, setOrderError] = useState('')
  const [premiumPerUnit, setPremiumPerUnit] = useState(0)
  const [smileOpen, setSmileOpen] = useState(false)

  // 종목/계약을 바꾸면 수량은 0으로 — OrderSheet가 종목 바뀔 때 key로 리마운트하는 것과 같은 이유.
  useEffect(() => setQty(0), [contractId])

  useEffect(() => {
    if (!contract) {
      setPremiumPerUnit(0)
      return
    }
    let alive = true
    const fetchQuote = async () => {
      const r = await onQuote(contract.id)
      if (alive && r.ok) setPremiumPerUnit(Number(r.premium_per_unit ?? 0))
    }
    fetchQuote()
    const id = setInterval(fetchQuote, 3000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [contract, onQuote])

  // PayoffDiagram(App.jsx의 형제 컴포넌트)에 지금 보고 있는 계약·프리미엄·수량을 알려준다.
  useEffect(() => {
    onQuoteChange?.(contract, premiumPerUnit, qty)
  }, [contract, premiumPerUnit, qty, onQuoteChange])

  const totalPremium = premiumPerUnit * qty
  const maxAffordable = premiumPerUnit > 0 ? Math.floor(cash / premiumPerUnit) : 0
  const heldQty = stock?.holding ?? 0

  const locked = !tradingOpen || !contract || placing
  const canBuy = tradingOpen && !!contract && !placing && qty > 0 && qty <= maxAffordable

  const autoFillHedge = () => {
    if (heldQty <= 0) {
      onNotify?.('보유 중인 주식이 없어요', 'down')
      return
    }
    setQty(Math.min(heldQty, maxAffordable || heldQty))
  }

  const submit = async () => {
    if (!contract || qty <= 0) return
    setOrderError('')
    const r = await onOrder(contract.id, qty)
    if (r?.ok) setQty(0)
    else setOrderError(errorText(r?.error ?? 'network'))
  }

  const closedNote = ended
    ? '대회가 끝났어요. 최종 결과를 확인하세요.'
    : !started
      ? '아직 대회가 시작되지 않았어요. 강사 선생님을 기다려 주세요.'
      : !tradingOpen
        ? '지금은 거래 시간이 아니에요. 강사 선생님이 타이머를 시작하면 매매할 수 있어요.'
        : null

  if (!stockContracts.length) {
    return (
      <aside className="col order hedge">
        <div className="order-top">
          {closedNote && (
            <div className="halted-note">
              <b>거래 대기</b>
              <span>{closedNote}</span>
            </div>
          )}
          <div className="halted-note">
            <b>등록된 옵션 없음</b>
            <span>이 종목엔 아직 강사 선생님이 등록한 옵션 계약이 없어요.</span>
          </div>
        </div>
      </aside>
    )
  }

  return (
    <aside className="col order hedge">
      <div className="order-top">
        {closedNote && (
          <div className="halted-note">
            <b>거래 대기</b>
            <span>{closedNote}</span>
          </div>
        )}

        {stockContracts.length > 1 && (
          <select
            className="opt-select"
            value={contractId ?? ''}
            onChange={(e) => setContractId(Number(e.target.value))}
            disabled={locked}
          >
            {stockContracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.option_type === 'put' ? '풋' : '콜'} · 행사가 ₩{num(c.strike)} · R{c.expiry_round} 만기
              </option>
            ))}
          </select>
        )}

        <div className="ordsec">
          <div className="cap">
            <span className="t">옵션 프리미엄(주당)</span>
            <span className="avail">{premiumPerUnit > 0 ? `₩ ${num(premiumPerUnit)}` : '조회 중…'}</span>
          </div>

          <button className="text-btn smile-trigger" onClick={() => setSmileOpen(true)}>
            📊 변동성 스마일
          </button>

          <button
            className="act-btn hedge-auto"
            onClick={autoFillHedge}
            disabled={locked}
            title="보유 중인 이 종목 수량만큼 풋옵션 수량을 채워요"
          >
            🛡️ 보유 주식 전체 풋옵션 헷지 (보유 {num(heldQty)}주)
          </button>

          <QtyStepper value={qty} onChange={setQty} max={maxAffordable} label="계약 수량" disabled={locked} />

          <div className="est">
            <span>예상 총 프리미엄</span>
            <span className="num">₩ {num(totalPremium)}</span>
          </div>

          {orderError && <p className="down" role="alert">{orderError} · 수량을 확인하고 다시 주문해 주세요.</p>}
          <button className="act-btn buy" disabled={!canBuy} onClick={submit}>
            {placing ? '체결 중…' : '옵션 매수'}
          </button>
        </div>
      </div>

      <VolatilitySmileModal
        open={smileOpen}
        onClose={() => setSmileOpen(false)}
        stockName={stock?.name}
        contracts={stockContracts}
      />
    </aside>
  )
}
