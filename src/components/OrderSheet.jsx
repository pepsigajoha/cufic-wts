import { useState } from 'react'
import { num, signed, pct, dirOf } from '../format'
import { positionPnl } from '../account'
import QtyStepper, { QtyRatios } from './QtyStepper'
import Modal from './Modal'

// 평가금액의 이 비율 이상을 한 번에 움직이는 주문이면 확인을 한 번 받는다(오조작 방지).
// UX 계층만 — 서버 place_order 판정은 그대로다.
const CONFIRM_RATIO = 0.7

/**
 * 주문 패널 — 즉시 체결.
 *
 * 작년 방식으로 되돌렸다. 매수·매도를 누르면 서버(place_order)가 그 자리에서 체결한다.
 * 단 거래 시간(관리자가 시작한 라운드 타이머)이 열려 있을 때만 가능하다. 타이머 밖 클릭은
 * 서버가 거부하고, 여기서는 버튼을 미리 잠가 왕복을 아낀다.
 *
 * @param {(side:'buy'|'sell', qty:number) => void} onOrder  즉시 체결 요청
 * @param {boolean} tradingOpen  타이머가 열려 거래 가능한 상태
 */
export default function OrderSheet({
  stock,
  execPrice = 0, // 장중 스텝 체결가(App이 라운드 진행률로 계산). 0이면 stock.price로 폴백.
  stepIndex = 251, // 지금 가상 며칠차(0..251) — 안내 표시용
  cash,
  onOrder,
  onSelectStock,
  placing,
  tradingOpen,
  started,
  ended,
  stocks,
  hasTraded,
  onNotify,
}) {
  // 증권사 주문창처럼 [매수 | 매도] 토글 하나로 전환한다. 수량은 이 종목·이 방향에 한정된 임시값 —
  // App이 key={종목코드}로 리마운트하므로 종목을 바꾸면 0으로 초기화되고, 방향을 바꿔도 0으로 되돌린다.
  const [side, setSide] = useState('buy')
  const [qty, setQty] = useState(0)
  const [confirm, setConfirm] = useState(false)
  const isBuy = side === 'buy'
  const pos = positionPnl(stock)

  const pickSide = (s) => {
    setSide(s)
    setQty(0)
  }

  // 체결은 장중 스텝 가격으로 일어난다 — 예상금액·최대수량을 그 값에 맞춘다(연말 확정가 stock.price가 아니라).
  const unit = execPrice > 0 ? execPrice : stock.price
  const buyable = stock.halted || unit <= 0 ? 0 : Math.floor(cash / unit)
  const sellable = stock.halted ? 0 : stock.holding

  // 지금 보유 중인 종목 — 무엇을 얼마에 갖고 있는지
  const held = stocks.filter((s) => s.holding > 0)
  const holdingsValue = held.reduce((sum, s) => sum + s.holding * s.price, 0)

  const max = isBuy ? buyable : sellable
  const canSubmit = tradingOpen && !stock.halted && !placing && qty > 0 && qty <= max
  // 거래 대기(타이머 밖)·거래정지면 매수·매도 입력 전체를 완전히 잠근다(양쪽 동일 시각)
  const locked = !tradingOpen || stock.halted

  // 이번 주문 금액이 평가금액(예수금 + 보유평가)의 CONFIRM_RATIO 이상이면 확인 모달을 한 번 띄운다.
  const equity = cash + holdingsValue
  const orderValue = qty * unit
  const equityPct = equity > 0 ? Math.round((orderValue / equity) * 100) : 0
  const needsConfirm = equity > 0 && orderValue >= equity * CONFIRM_RATIO

  const doSubmit = async () => {
    setConfirm(false)
    await onOrder(side, qty)
    setQty(0)
  }
  const submit = () => {
    if (needsConfirm) {
      setConfirm(true)
      return
    }
    doSubmit()
  }

  // 거래가 닫힌 이유 (안내 문구). 종목별 거래정지는 아래에서 따로 안내한다.
  const closedNote = ended
    ? '대회가 끝났어요. 최종 결과를 확인하세요.'
    : !started
      ? '아직 대회가 시작되지 않았어요. 강사 선생님을 기다려 주세요.'
      : !tradingOpen && !stock.halted
        ? '지금은 거래 시간이 아니에요. 강사 선생님이 타이머를 시작하면 매매할 수 있어요.'
        : null

  return (
    <aside className="col order">
      {/* 매수·매도는 위에 고정 — 화면 높이와 무관하게 버튼이 항상 보인다 */}
      <div className="order-top">
        {closedNote && (
          <div className="halted-note">
            <b>거래 대기</b>
            <span>{closedNote}</span>
          </div>
        )}
        {stock.halted && (
          <div className="halted-note">
            <b>거래정지</b>
            <span>이 종목은 지금 사고팔 수 없어요.</span>
          </div>
        )}

        {/* 장중 현재가 — 체결이 일어나는 값. 라운드 진행에 따라 초 단위로 바뀐다. */}
        {!stock.halted && tradingOpen && (
          <div className="est livenow">
            <span>현재가 (가상 {Math.min(252, stepIndex + 1)}/252일차)</span>
            <span className="num">₩ {num(unit)}</span>
          </div>
        )}

        {/* 주문창 — [매수 | 매도] 토글 하나로 전환 */}
        <div className="ordsec">
          <div className="side-tabs" role="tablist" aria-label="주문 방향">
            <button
              className={'side-tab buy' + (isBuy ? ' on' : '')}
              role="tab"
              aria-selected={isBuy}
              onClick={() => pickSide('buy')}
            >
              매수
            </button>
            <button
              className={'side-tab sell' + (!isBuy ? ' on' : '')}
              role="tab"
              aria-selected={!isBuy}
              onClick={() => pickSide('sell')}
            >
              매도
            </button>
          </div>

          <div className="cap">
            <span className="avail">
              {isBuy ? `주문가능 ${num(buyable)}주` : `보유 ${num(stock.holding)}주`}
            </span>
          </div>

          {/* 내 보유 현황 — 매수·매도 양쪽에서 본다(매수 시엔 추가 매수 판단, 매도 시엔 청산 판단) */}
          {stock.holding > 0 && (
            <div className="posbox">
              <div className="r">
                <span className="k">보유</span>
                <span className="v num">{num(stock.holding)}주</span>
              </div>
              <div className="r">
                <span className="k">평균단가</span>
                <span className="v num">₩ {num(stock.avgPrice)}</span>
              </div>
              <div className="r">
                <span className="k">평가손익</span>
                <span className={'v num ' + dirOf(pos.pnl)}>
                  {signed(pos.pnl)} ({pct(pos.pnlPct)})
                </span>
              </div>
            </div>
          )}

          <QtyRatios
            max={max}
            value={qty}
            onPick={setQty}
            maxLabel={isBuy ? '최대' : '전량'}
            disabled={locked}
            onBlocked={() =>
              onNotify?.(
                isBuy ? '주문가능 금액으로 살 수 있는 수량이 없어요' : '팔 수 있는 보유 주식이 없어요',
                'down',
              )
            }
          />
          <QtyStepper
            value={qty}
            onChange={setQty}
            max={max}
            label={isBuy ? '매수 수량' : '매도 수량'}
            maxLabel={isBuy ? undefined : '전량'}
            disabled={locked}
          />
          <div className="est">
            <span>{isBuy ? '예상 매수금액' : '예상 매도금액'}</span>
            <span className="num">₩ {num(qty * unit)}</span>
          </div>
          <button
            className={'act-btn ' + (isBuy ? 'buy' : 'sell')}
            disabled={!canSubmit}
            onClick={submit}
          >
            {placing ? '체결 중…' : isBuy ? '매수' : '매도'}
          </button>
        </div>
      </div>

      {/* 보유종목·안내는 아래에서 스크롤 (넘쳐도 매수·매도는 안 밀린다) */}
      <div className="order-scroll">
        <div>
          {/* 보유종목 — 지금 무엇을 얼마에 갖고 있는지 */}
          <div className="ordsec holdings">
            <div className="cap">
              <span className="t">보유종목</span>
              <span className="avail">
                {held.length > 0 ? `보유주식 평가 ₩ ${num(holdingsValue)}` : `${held.length}개`}
              </span>
            </div>

            {held.length === 0 ? (
              <p className="holdings-empty">
                아직 가진 종목이 없어요. 거래 시간에 매수하면 여기에 나타나요.
              </p>
            ) : (
              <div className="hold-list">
                {/* 종목명 | 보유주식 수 | 금액 */}
                <div className="hold-head">
                  <span>종목명</span>
                  <span>보유</span>
                  <span>금액</span>
                </div>
                {held.map((s) => (
                  <button
                    key={s.code}
                    className={'hold-row' + (s.code === stock.code ? ' on' : '') + (s.halted ? ' delisted' : '')}
                    onClick={() => onSelectStock?.(s.code)}
                    title={s.halted ? `${s.name} — 상장폐지(전액 손실)` : `${s.name} 주문하기`}
                  >
                    <span className="hnm">{s.name}</span>
                    <span className="hq num">{num(s.holding)}주</span>
                    <span className="hval num">
                      {s.halted ? '⚠ 상장폐지' : `₩ ${num(s.holding * s.price)}`}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 안내 — 아직 한 번도 거래 안 한 학생에게만. 첫 체결 뒤엔 자리를 비운다. */}
          {!hasTraded && (
            <div className="ordsec sheet-save">
              <p className="sheet-hint">
                매수·매도는 <b>누르는 즉시 체결</b>돼요. 강사 선생님이 <b>타이머를 시작한 동안</b>에만
                매매할 수 있고, 시간이 끝나면 자동으로 닫혀요.
              </p>
            </div>
          )}
        </div>
      </div>

      <Modal open={confirm} onClose={() => setConfirm(false)} title="주문 확인">
        <div className="confirm">
          <p className="big">
            {stock.name} · {isBuy ? '매수' : '매도'} {num(qty)}주
          </p>
          <p className="amt num">₩ {num(orderValue)}</p>
          {equity > 0 && (
            <p className="ask">
              평가금액의 <b>{equityPct}%</b>를 한 번에 {isBuy ? '사는' : '파는'} 주문이에요. 정말
              {isBuy ? ' 매수' : ' 매도'}할까요?
            </p>
          )}
        </div>
        <div className="mfoot">
          <button className="cancel" onClick={() => setConfirm(false)}>
            취소
          </button>
          <button className={isBuy ? 'buy' : 'sell'} onClick={doSubmit}>
            {isBuy ? '매수' : '매도'}
          </button>
        </div>
      </Modal>
    </aside>
  )
}
