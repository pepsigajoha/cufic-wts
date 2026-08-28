import { useMemo, useState } from 'react'
import Modal from '../components/Modal'
import { errorText } from '../supabase'
import { num } from '../format'

/** 종목·가격 탭. 연도별 가격을 인라인으로 고친다. */
export default function AdminStocks({ actions, game, stocks, refresh, notify }) {
  const [editing, setEditing] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const [busy, setBusy] = useState(false)

  // 게임에 실제 등장하는 연도만 = 라운드 연도 + 최종 정산 연도 (유령 열 없음)
  const finalYear = Number(game?.final_year) || null
  const years = useMemo(() => {
    const set = new Set(Object.values(game?.round_year_map ?? {}).map(Number).filter(Boolean))
    if (finalYear) set.add(finalYear)
    return [...set].sort((a, b) => a - b)
  }, [game, finalYear])

  const save = async (s) => {
    setBusy(true)
    const r = await actions.upsertStock(s)
    setBusy(false)
    if (!r.ok) return notify(errorText(r.error), 'down')
    setEditing(null)
    notify('종목을 저장했어요', 'gold')
    await refresh()
  }

  const del = async (id) => {
    setBusy(true)
    const r = await actions.deleteStock(id)
    setBusy(false)
    setConfirmDel(null)
    if (!r.ok) return notify(errorText(r.error), 'down')
    notify('종목을 지웠어요', 'gold')
    await refresh()
  }

  return (
    <div className="apanel">
      <section className="acard">
        <div className="acard-head">
          <span className="acap">종목 ({stocks.length})</span>
          <button
            className="text-btn"
            onClick={() =>
              setEditing({
                id: '',
                name: '',
                description: '',
                sector: '',
                listed_from_round: 1,
                prices: {},
                display_order: stocks.length,
              })
            }
          >
            + 종목 추가
          </button>
        </div>

        <p className="anote">
          가격을 <b>0으로 두거나 비우면 거래정지</b>로 동작합니다 (매수·매도 차단, 평가액 0).
          신규 상장은 그 이전 연도를 비워두면 됩니다.
        </p>
        {(game?.current_round ?? 0) > 0 && (
          <p className="awarn">
            대회 시작 후 가격 수정은 <b>이미 체결된 거래에 소급되지 않습니다.</b> 앞으로의 평가·체결에만
            적용됩니다.
          </p>
        )}

        <div className="scroller">
          <table>
            <thead>
              <tr>
                <th>종목</th>
                <th>소개</th>
                {years.map((y) => (
                  <th key={y}>
                    {y}
                    {y === finalYear && <div className="sub">최종 정산</div>}
                  </th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {stocks.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.name}
                    <div className="sub">{s.id}</div>
                  </td>
                  <td className="desc-cell">{s.description || '—'}</td>
                  {years.map((y) => {
                    const v = Number(s.prices?.[String(y)] ?? 0)
                    return (
                      <td key={y} className="num">
                        {v > 0 ? num(v) : <span className="halted-tag">정지</span>}
                      </td>
                    )
                  })}
                  <td>
                    <button className="text-btn tiny" onClick={() => setEditing(s)}>
                      수정
                    </button>
                    <button className="text-btn danger tiny" onClick={() => setConfirmDel(s)}>
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <StockEditor
        stock={editing}
        years={years}
        busy={busy}
        onClose={() => setEditing(null)}
        onSave={save}
      />

      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="종목 삭제">
        {confirmDel && (
          <div className="confirm">
            <p className="big">
              <b>{confirmDel.name}</b>
            </p>
            <p className="ask">이 종목의 보유·체결내역도 함께 사라집니다.</p>
          </div>
        )}
        <div className="mfoot">
          <button className="cancel" onClick={() => setConfirmDel(null)}>
            취소
          </button>
          <button className="act-btn sell" disabled={busy} onClick={() => del(confirmDel.id)}>
            삭제
          </button>
        </div>
      </Modal>
    </div>
  )
}

function StockEditor({ stock, years, busy, onClose, onSave }) {
  const key = stock?.id ?? 'new'
  const [draft, setDraft] = useState(null)
  const cur = draft?.__key === key ? draft : { ...stock, __key: key }

  if (!stock) return null
  const set = (patch) => setDraft({ ...cur, ...patch })
  const setPrice = (y, v) => {
    const n = Number(String(v).replace(/\D/g, ''))
    const prices = { ...cur.prices }
    if (!n) delete prices[String(y)]
    else prices[String(y)] = n
    set({ prices })
  }

  return (
    <Modal open onClose={onClose} title={stock.id ? `${stock.name} 수정` : '종목 추가'} wide>
      <div className="form">
        <div className="frow col">
          <label>종목코드</label>
          <input
            className="num"
            value={cur.id}
            disabled={!!stock.id}
            onChange={(e) => set({ id: e.target.value })}
            placeholder="A001"
          />
        </div>
        <div className="frow col">
          <label>종목명</label>
          <input value={cur.name} onChange={(e) => set({ name: e.target.value })} placeholder="한빛반도체" />
        </div>
        <div className="frow col">
          <label>한 줄 소개</label>
          <input
            value={cur.description ?? ''}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="반도체를 만드는 회사예요"
          />
        </div>
        <div className="frow two">
          <div className="frow col">
            <label>업종</label>
            <input
              value={cur.sector ?? ''}
              onChange={(e) => set({ sector: e.target.value })}
              placeholder="반도체"
            />
          </div>
          <div className="frow col">
            <label>상장 라운드 (이 라운드부터 노출)</label>
            <input
              className="num"
              type="number"
              min="1"
              value={cur.listed_from_round ?? 1}
              onChange={(e) => set({ listed_from_round: Number(e.target.value) || 1 })}
            />
          </div>
        </div>
        <div className="frow col">
          <label>연도별 가격 (비우면 거래정지)</label>
          <div className="price-grid">
            {years.map((y) => (
              <div key={y} className="pcell">
                <span>{y}</span>
                <input
                  className="num"
                  value={cur.prices?.[String(y)] ?? ''}
                  onChange={(e) => setPrice(y, e.target.value)}
                  placeholder="0"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mfoot">
        <button className="cancel" onClick={onClose}>
          취소
        </button>
        <button
          className="act-btn buy"
          disabled={busy || !cur.id?.trim() || !cur.name?.trim()}
          onClick={() => onSave(cur)}
        >
          저장
        </button>
      </div>
    </Modal>
  )
}
