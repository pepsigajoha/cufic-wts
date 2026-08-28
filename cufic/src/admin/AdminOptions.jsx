import { useState } from 'react'
import Modal from '../components/Modal'
import { errorText } from '../supabase'
import { num } from '../format'

/**
 * 옵션(파생) 계약 관리 탭. AdminStocks.jsx와 같은 표+에디터 패턴.
 *
 * 옵션은 종목 가격처럼 "고쳐 쓰는" 게 아니라 항상 새로 등록한다 — 실제 옵션 시장도
 * 조건(행사가·만기 등)이 바뀌면 별개 계약이지, 기존 계약을 고치지 않는다. 그래서
 * 여기 수정 버튼은 없고 등록/비활성화만 있다(admin_upsert_options_contract는 이름과
 * 달리 실제로는 매번 새 계약을 만든다 — 헷갈리지 않게 이 화면에서는 "등록"이라고만 부른다).
 */
export default function AdminOptions({ actions, game, stocks, optionsContracts, refresh, notify }) {
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)

  const currentRound = game?.current_round ?? 0
  const contracts = (optionsContracts ?? []).slice().sort((a, b) => b.id - a.id)

  const stockName = (id) => stocks.find((s) => s.id === id)?.name ?? id

  const register = async (draft) => {
    setBusy(true)
    const r = await actions.upsertOptionsContract(draft)
    setBusy(false)
    if (!r.ok) return notify(errorText(r.error), 'down')
    setEditing(null)
    notify('옵션 계약을 등록했어요', 'gold')
    await refresh()
  }

  const deactivate = async (id) => {
    setBusy(true)
    const r = await actions.deactivateOptionsContract(id)
    setBusy(false)
    if (!r.ok) return notify(errorText(r.error), 'down')
    notify('계약을 비활성화했어요', 'gold')
    await refresh()
  }

  return (
    <div className="apanel">
      <section className="acard">
        <div className="acard-head">
          <span className="acap">옵션 계약 ({contracts.length})</span>
          <button
            className="text-btn"
            onClick={() =>
              setEditing({
                stockId: stocks[0]?.id ?? '',
                optionType: 'put',
                strike: '',
                expiryRound: currentRound + 2,
                impliedVol: 35,
                riskFreeRate: 2,
              })
            }
          >
            + 계약 등록
          </button>
        </div>

        <p className="anote">
          학생은 <b>파생·헷지 탭</b>에서 여기 등록한 계약만 매수할 수 있어요. 만기 라운드가 되면{' '}
          <b>연도 넘기기(advance_round) 때 자동으로 내재가치로 정산</b>됩니다 — 따로 결제할 필요 없어요.
        </p>

        <div className="scroller">
          <table>
            <thead>
              <tr>
                <th>종목</th>
                <th>종류</th>
                <th>행사가</th>
                <th>만기</th>
                <th>변동성(σ)</th>
                <th>무위험금리(r)</th>
                <th>상태</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td>{stockName(c.stock_id)}</td>
                  <td>{c.option_type === 'put' ? '풋' : '콜'}</td>
                  <td className="num">₩{num(c.strike)}</td>
                  <td>
                    R{c.expiry_round}
                    {c.expiry_round <= currentRound && <div className="sub">만기 지남</div>}
                  </td>
                  <td className="num">{(Number(c.implied_vol) * 100).toFixed(1)}%</td>
                  <td className="num">{(Number(c.risk_free_rate) * 100).toFixed(1)}%</td>
                  <td>{c.active ? <span className="tag-ok">활성</span> : <span className="halted-tag">비활성</span>}</td>
                  <td>
                    {c.active && (
                      <button className="text-btn danger tiny" disabled={busy} onClick={() => deactivate(c.id)}>
                        비활성화
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {contracts.length === 0 && (
                <tr>
                  <td colSpan={8} className="desc-cell">
                    등록된 옵션 계약이 없어요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <OptionEditor
        draft={editing}
        stocks={stocks}
        currentRound={currentRound}
        busy={busy}
        onClose={() => setEditing(null)}
        onSave={register}
      />
    </div>
  )
}

function OptionEditor({ draft, stocks, currentRound, busy, onClose, onSave }) {
  const [form, setForm] = useState(null)
  const cur = form ?? draft

  if (!draft) return null
  const set = (patch) => setForm({ ...cur, ...patch })

  const strikeNum = Number(cur.strike)
  const expiryNum = Number(cur.expiryRound)
  const volNum = Number(cur.impliedVol)
  const valid = !!cur.stockId && strikeNum > 0 && expiryNum > currentRound && volNum > 0

  const submit = () => {
    onSave({
      stockId: cur.stockId,
      optionType: cur.optionType,
      strike: strikeNum,
      expiryRound: expiryNum,
      impliedVol: volNum / 100, // 화면은 % 단위, 서버는 소수(0.35=35%)
      riskFreeRate: (Number(cur.riskFreeRate) || 0) / 100,
    })
  }

  return (
    <Modal open onClose={onClose} title="옵션 계약 등록">
      <div className="form">
        <div className="frow col">
          <label>대상 종목</label>
          <select value={cur.stockId} onChange={(e) => set({ stockId: e.target.value })}>
            {stocks.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="frow two">
          <div className="frow col">
            <label>종류</label>
            <select value={cur.optionType} onChange={(e) => set({ optionType: e.target.value })}>
              <option value="put">풋 (Put) — 하락 방어</option>
              <option value="call">콜 (Call) — 상승 베팅</option>
            </select>
          </div>
          <div className="frow col">
            <label>행사가 K (원)</label>
            <input
              className="num"
              type="number"
              min="1"
              value={cur.strike}
              onChange={(e) => set({ strike: e.target.value })}
              placeholder="예: 10000"
            />
          </div>
        </div>
        <div className="frow two">
          <div className="frow col">
            <label>만기 라운드 (현재 R{currentRound})</label>
            <input
              className="num"
              type="number"
              min={currentRound + 1}
              value={cur.expiryRound}
              onChange={(e) => set({ expiryRound: e.target.value })}
            />
          </div>
          <div className="frow col">
            <label>변동성 σ (%)</label>
            <input
              className="num"
              type="number"
              min="0.1"
              step="0.1"
              value={cur.impliedVol}
              onChange={(e) => set({ impliedVol: e.target.value })}
            />
          </div>
        </div>
        <div className="frow col">
          <label>무위험금리 r (%)</label>
          <input
            className="num"
            type="number"
            min="0"
            step="0.1"
            value={cur.riskFreeRate}
            onChange={(e) => set({ riskFreeRate: e.target.value })}
          />
        </div>
        {expiryNum > 0 && expiryNum <= currentRound && (
          <p className="awarn">만기 라운드는 현재 라운드(R{currentRound})보다 뒤여야 해요.</p>
        )}
      </div>
      <div className="mfoot">
        <button className="cancel" onClick={onClose}>
          취소
        </button>
        <button className="act-btn buy" disabled={busy || !valid} onClick={submit}>
          등록
        </button>
      </div>
    </Modal>
  )
}
