import { useState } from 'react'
import Modal from './Modal'
import { errorText } from '../supabase'
import { num, pct, signed, dirOf } from '../format'

/**
 * 예금 탭 — 안전자산 선택지.
 *
 * [금리] 상품에 고정금리를 박아 두지 않는다. 그 라운드 연도의 **기준금리(macro.rate)**를 그대로 쓴다
 * (마이그레이션 0052 savings_rate). 학생이 시황판에서 읽는 기준금리와 예금 금리가 같은 숫자라
 * "금리가 오르면 예금이 유리해진다"가 데이터로 드러난다.
 *
 * [이자] 라운드가 넘어갈 때 서버(accrue_savings_interest)가 복리로 붙인다 — 화면에서 계산하지 않는다.
 * 여기 표시는 전부 서버가 확정한 balance를 읽어서 보여주는 것뿐이다.
 *
 * @param {Array} savings  user_savings 활성 행 (principal·balance·start_round)
 * @param {number} rate    이번 라운드 예금 금리(%) — App이 macro에서 뽑아 넘긴다
 */
export default function Savings({
  savings = [],
  rate,
  cash,
  round,
  roundYearMap,
  macro,
  started,
  ended,
  busy,
  onOpen,
  onWithdraw,
  onNotify,
}) {
  const [amount, setAmount] = useState(0)
  const [openError, setOpenError] = useState('')
  const [withdrawId, setWithdrawId] = useState(null)
  const [withdrawError, setWithdrawError] = useState('')
  const withdrawal = savings.find((s) => s.id === withdrawId)
  const principal = Number(withdrawal?.principal ?? 0)
  const balance = Number(withdrawal?.balance ?? 0)
  // withdraw_savings와 같은 원 단위 반올림. 표시값은 예상이며 최종 확정은 서버.
  const payout = principal + Math.round(Math.max(0, balance - principal) * 0.5)

  const openDeposit = async () => {
    if (!canOpen) return
    setOpenError('')
    const r = await onOpen(amt)
    if (r?.ok) setAmount(0)
    else setOpenError(errorText(r?.error ?? 'network'))
  }
  const confirmWithdraw = async () => {
    if (!withdrawal || busy || ended) return
    setWithdrawError('')
    const r = await onWithdraw(withdrawal.id)
    if (r?.ok) setWithdrawId(null)
    else setWithdrawError(errorText(r?.error ?? 'network'))
  }

  const amt = Math.max(0, Math.floor(Number(amount) || 0))
  const canOpen = started && !ended && !busy && amt > 0 && amt <= cash
  const totalPrincipal = savings.reduce((s, r) => s + Number(r.principal), 0)
  const totalBalance = savings.reduce((s, r) => s + Number(r.balance), 0)
  const totalInterest = totalBalance - totalPrincipal

  const pick = (ratio) => {
    if (cash <= 0) {
      onNotify?.('예금에 넣을 예수금이 없어요', 'down')
      return
    }
    setAmount(Math.floor(cash * ratio))
  }

  // 연도별 기준금리 추이 — 지금 라운드 연도까지만(미래 스포일러 차단, 시황판과 동일 규칙)
  const rateHistory = Object.entries(roundYearMap ?? {})
    .map(([r, y]) => [Number(r), Number(y)])
    .filter(([r]) => r >= 1 && r <= (round ?? 0))
    .sort((a, b) => a[0] - b[0])
    .map(([r, y]) => ({ round: r, year: y, rate: Number(macro?.[y]?.rate) }))
    .filter((d) => Number.isFinite(d.rate))
  const maxRate = Math.max(1, ...rateHistory.map((d) => d.rate))

  return (
    <>
      {/* 가운데 — 예금이 무엇인지, 금리가 어떻게 움직여 왔는지 */}
      <div className="col sav-info">
        <div className="sav-head">
          <span className="sav-title">🏦 예금</span>
          <span className="sav-sub">원금이 보장되는 대신, 수익도 금리만큼만</span>
        </div>

        <div className="sav-scroll">
          <div className="sav-rate-now">
            <span className="k">이번 라운드 예금 금리</span>
            <span className="v num">{Number.isFinite(rate) ? `${rate}%` : '—'}</span>
            <span className="sav-rate-note">
              그 해 <b>기준금리</b>와 같아요. 시황판에서 보는 그 숫자예요.
            </span>
          </div>

          {rateHistory.length > 0 && (
            <div className="sav-block">
              <span className="rb-cap">연도별 금리</span>
              <div className="sav-bars">
                {rateHistory.map((d) => (
                  <div key={d.round} className={'sav-bar' + (d.round === round ? ' on' : '')}>
                    <span className="sb-val num">{d.rate}%</span>
                    <div className="sb-track">
                      <span className="sb-fill" style={{ height: (d.rate / maxRate) * 100 + '%' }} />
                    </div>
                    <span className="sb-year num">{d.year}</span>
                  </div>
                ))}
              </div>
              <p className="anote">
                금리가 높은 해일수록 예금이 유리해요. 반대로 금리가 낮으면 예금에 넣어 둔 돈은
                거의 안 불어나요 — 그럴 땐 주식이 더 나을 수도 있죠.
              </p>
            </div>
          )}

          <div className="sav-block">
            <span className="rb-cap">알아 둘 것</span>
            <ul className="sav-rules">
              <li>
                이자는 <b>라운드(=1년)가 넘어갈 때</b> 복리로 붙어요. 라운드 중에는 안 변해요.
              </li>
              <li>
                예금에 넣은 돈도 <b>내 평가금액에 그대로 포함</b>돼요 — 순위에서 손해 보지 않아요.
              </li>
              <li>
                중도에 해지하면 <b>원금은 전부 돌려받지만, 그동안 쌓인 이자는 절반만</b> 받아요.
              </li>
              <li>예금 가입·해지는 거래 시간이 아니어도 언제든 할 수 있어요.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* 오른쪽 — 가입 폼 + 내 예금 */}
      <aside className="col order sav-panel">
        <div className="order-top">
          {!started && (
            <div className="halted-note">
              <b>대기 중</b>
              <span>대회가 시작되면 예금에 가입할 수 있어요.</span>
            </div>
          )}
          {ended && (
            <div className="halted-note">
              <b>대회 종료</b>
              <span>더 이상 가입·해지할 수 없어요.</span>
            </div>
          )}

          <div className="ordsec">
            <div className="cap">
              <span className="t">예금 가입</span>
              <span className="avail">예수금 ₩{num(cash)}</span>
            </div>

            <div className="sav-ratios">
              {[
                ['10%', 0.1],
                ['25%', 0.25],
                ['50%', 0.5],
                ['최대', 1],
              ].map(([label, r]) => (
                <button
                  key={label}
                  className="sav-ratio"
                  disabled={!started || ended || busy}
                  onClick={() => pick(r)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="sav-amt">
              {/* .num(모노 폰트)을 안 쓴다 — 한글 placeholder가 모노로 렌더돼 자간이 벌어진다.
                  숫자 정렬은 아래 CSS의 tnum으로 충분하다. */}
              <input
                type="number"
                min="0"
                step="10000"
                value={amount || ''}
                placeholder="예치 금액"
                aria-label="예치 금액"
                disabled={!started || ended || busy}
                onChange={(e) => setAmount(e.target.value)}
              />
              <span className="sav-won">원</span>
            </div>

            <div className="est">
              <span>1년 뒤 예상 (금리 {Number.isFinite(rate) ? rate : 0}%)</span>
              <span className="num">
                ₩ {num(Math.round(amt * (1 + (Number.isFinite(rate) ? rate : 0) / 100)))}
              </span>
            </div>

            {amt > cash && <p className="sav-warn">예수금보다 많이 넣을 수 없어요.</p>}

            {openError && <p className="sav-warn" role="alert">{openError} · 금액을 확인하고 다시 가입해 주세요.</p>}
            <button className="act-btn buy" disabled={!canOpen} onClick={openDeposit}>
              {busy ? '처리 중…' : '예금 가입'}
            </button>
          </div>
        </div>

        <div className="order-scroll">
          <div className="ordsec">
            <div className="cap">
              <span className="t">내 예금</span>
              {savings.length > 0 && <span className="avail">{savings.length}건</span>}
            </div>

            {savings.length === 0 ? (
              <p className="holdings-empty">
                아직 가입한 예금이 없어요. 금리를 보고 판단해 보세요.
              </p>
            ) : (
              <>
                <div className="posbox">
                  <div className="r">
                    <span className="k">원금 합계</span>
                    <span className="v num">₩ {num(totalPrincipal)}</span>
                  </div>
                  <div className="r">
                    <span className="k">현재 잔액</span>
                    <span className="v num">₩ {num(totalBalance)}</span>
                  </div>
                  <div className="r">
                    <span className="k">누적 이자</span>
                    <span className={'v num ' + dirOf(totalInterest)}>
                      {signed(totalInterest)} (
                      {pct(totalPrincipal > 0 ? (totalInterest / totalPrincipal) * 100 : 0)})
                    </span>
                  </div>
                </div>

                <div className="sav-list">
                  {savings.map((s) => {
                    const p = Number(s.principal)
                    const b = Number(s.balance)
                    const gain = b - p
                    return (
                      <div key={s.id} className="sav-row">
                        <div className="sv-main">
                          <span className="sv-bal num">₩ {num(b)}</span>
                          <span className={'sv-gain num ' + dirOf(gain)}>
                            {signed(gain)} ({pct(p > 0 ? (gain / p) * 100 : 0)})
                          </span>
                        </div>
                        <div className="sv-meta">
                          <span>
                            원금 ₩{num(p)} · R{s.start_round} 가입
                          </span>
                          <button
                            className="text-btn danger tiny"
                            disabled={busy || ended}
                            onClick={() => { setWithdrawError(''); setWithdrawId(s.id) }}
                          >
                            해지
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <p className="sav-hint">
                  해지하면 <b>원금 + 이자의 절반</b>만 예수금으로 돌아와요. 만기까지 두는 게 유리해요.
                </p>
              </>
            )}
          </div>
        </div>
      </aside>
      <Modal open={withdrawId != null} onClose={() => { if (!busy) setWithdrawId(null) }} title="예금 해지 확인">
        <div className="confirm">
          <p className="big">이 예금을 해지할까요?</p>
          <div className="posbox">
            <div className="r"><span className="k">돌려받을 예상 금액</span><span className="v num">₩ {num(payout)}</span></div>
            <div className="r"><span className="k">소멸할 이자</span><span className="v num down">₩ {num(balance - payout)}</span></div>
          </div>
          <p className="ask">원금은 전부 돌려받고, 누적 이자는 절반만 받아요. 해지한 예금은 되돌릴 수 없어요.</p>
          {!withdrawal && <p role="alert">이미 해지됐거나 더 이상 가입 내역에 없는 예금이에요.</p>}
          {ended && <p role="alert">대회가 끝나 더 이상 해지할 수 없어요.</p>}
          {withdrawError && <p className="down" role="alert">{withdrawError} · 다시 시도해 주세요.</p>}
        </div>
        <div className="mfoot">
          <button className="cancel" disabled={busy} onClick={() => setWithdrawId(null)}>취소</button>
          <button className="sell" disabled={busy || ended || !withdrawal} onClick={confirmWithdraw}>{busy ? '처리 중…' : '해지하기'}</button>
        </div>
      </Modal>
    </>
  )
}
