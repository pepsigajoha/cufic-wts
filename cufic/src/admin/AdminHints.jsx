import { useMemo, useState } from 'react'
import Modal from '../components/Modal'
import { errorText } from '../supabase'
import { num } from '../format'
import { hintMismatches } from '../dataCheck'
import { distribute, rankWorstFirst } from '../distribute'

const GRADES = ['S', 'A', 'B', 'C', 'D']
const IMPACTS = [
  { v: 'up', label: '호재' },
  { v: 'down', label: '악재' },
  { v: 'flat', label: '중립' },
]

const empty = (round) => ({
  id: null,
  round,
  grade: 'B',
  headline: '',
  impact: 'up',
  related_stock_ids: [],
})

/**
 * 힌트 탭. [잠정 설계 — UI 명세 미수령]
 *
 * 배분 판단은 사람이 한다. 시스템은 제안만 하고, 강사가 확인해서 확정한다.
 * 자동으로 지급해버리면 "왜 우리 조만 D등급이냐"에 답할 사람이 없어진다.
 */
export default function AdminHints({ actions, game, stocks, teams, hints, refresh, notify }) {
  const round = game?.current_round || 1
  const [filterRound, setFilterRound] = useState(round)
  const [editing, setEditing] = useState(null)
  const [selectedHint, setSelectedHint] = useState(null)
  const [picked, setPicked] = useState([]) // 지급할 조 코드
  const [busy, setBusy] = useState(false)

  const rounds = useMemo(
    () => Object.keys(game?.round_year_map ?? {}).map(Number).sort((a, b) => a - b),
    [game],
  )
  // 힌트 풀은 항상 S→A→B→C→D 순으로 고정 정렬
  const shown = hints
    .filter((h) => h.round === filterRound)
    .slice()
    .sort((a, b) => GRADES.indexOf(a.grade) - GRADES.indexOf(b.grade))

  // 하위권 = 평가금액이 낮은 조
  const ranked = useMemo(
    () => [...teams].sort((a, b) => Number(a.equity) - Number(b.equity)),
    [teams],
  )

  // 자동 배분 미리보기 — 다음 라운드 진입 시 순위대로 어떤 등급/힌트가 나갈지.
  // ⚠ 현재 순위 기준 예상. [연도 넘기기]가 새 가격 공개 후 순위로 실제 배분한다(달라질 수 있음).
  const preview = useMemo(() => {
    const next = Number(game?.current_round ?? 0) + 1
    const total = Number(game?.total_rounds ?? 0)
    if (next < 2 || next > total || teams.length === 0) return null // R1은 지급 없음
    const pool = hints.filter((h) => h.round === next)
    const map = distribute(teams, pool) // code → 받을 힌트 배열 (라운드로빈)
    // 순위: 꼴찌 먼저 정렬 → 뒤에서부터 1위. 표는 1위 먼저 보이게.
    const worstFirst = rankWorstFirst(teams)
    const rankByCode = Object.fromEntries(worstFirst.map((t, i) => [t.code, teams.length - i]))
    const rows = teams
      .map((t) => {
        const got = map.get(t.code) ?? []
        return {
          code: t.code,
          name: t.name,
          equity: Number(t.equity),
          rank: rankByCode[t.code],
          grades: got.map((h) => h.grade),
          headlines: got.map((h) => h.headline),
        }
      })
      .sort((a, b) => a.rank - b.rank)
    return { round: next, rows, hasPool: pool.length > 0 }
  }, [teams, hints, game])

  const save = async (h) => {
    setBusy(true)
    const r = await actions.upsertHint(h)
    setBusy(false)
    if (!r.ok) {
      notify(r.error === 'unknown_stock' ? '없는 종목이 포함돼 있어요' : errorText(r.error), 'down')
      return
    }
    setEditing(null)
    notify(h.id ? '힌트를 수정했어요' : '힌트를 만들었어요', 'gold')
    await refresh()
  }

  const del = async (id) => {
    setBusy(true)
    const r = await actions.deleteHint(id)
    setBusy(false)
    if (!r.ok) return notify(errorText(r.error), 'down')
    if (selectedHint?.id === id) setSelectedHint(null)
    notify('힌트를 지웠어요', 'gold')
    await refresh()
  }

  const grant = async () => {
    if (!selectedHint || picked.length === 0) return
    setBusy(true)
    const r = await actions.grantHints(picked.map((code) => ({ hint_id: selectedHint.id, team_code: code })))
    setBusy(false)
    if (!r.ok) return notify(errorText(r.error), 'down')
    notify(`${r.granted}개 조에 지급했어요`, 'gold')
    setPicked([])
    await refresh()
  }

  const revoke = async (hintId, code) => {
    const r = await actions.revokeHint(hintId, code)
    if (!r.ok) return notify(errorText(r.error), 'down')
    await refresh()
  }

  return (
    <div className="apanel wide2">
      {/* ── 힌트 풀 */}
      <section className="acard">
        <div className="acard-head">
          <span className="acap">힌트 풀</span>
          <div className="tabs mini">
            {rounds.map((r) => (
              <button key={r} className={filterRound === r ? 'on' : ''} onClick={() => setFilterRound(r)}>
                R{r}
              </button>
            ))}
          </div>
          <button className="text-btn" onClick={() => setEditing(empty(filterRound))}>
            + 힌트 작성
          </button>
        </div>

        {shown.length === 0 ? (
          <p className="aempty">R{filterRound}에 힌트가 없습니다.</p>
        ) : (
          <div className="hint-list">
            {shown.map((h) => (
              <div
                key={h.id}
                className={'hint-row' + (selectedHint?.id === h.id ? ' on' : '')}
                onClick={() => setSelectedHint(h)}
              >
                <span className={'grade g' + h.grade}>{h.grade}</span>
                <div className="hint-body">
                  <div className="hl">{h.headline}</div>
                  <div className="hm">
                    <span className={'itag ' + h.impact}>
                      {IMPACTS.find((i) => i.v === h.impact)?.label}
                    </span>
                    <span className="rel-ids">
                      {h.related_stock_ids.length
                        ? h.related_stock_ids
                            .map((id) => stocks.find((s) => s.id === id)?.name ?? id)
                            .join(' · ')
                        : '전체 시장'}
                    </span>
                    <span className="granted">지급 {h.granted_to.length}조</span>
                    {hintMismatches(h, stocks, game).length > 0 && (
                      <span className="mismatch" title="호재/악재 태그가 관련 종목의 다음 해 실제 등락과 어긋나요">
                        ⚠ 등락 불일치
                      </span>
                    )}
                  </div>
                </div>
                <div className="hint-acts">
                  <button
                    className="text-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditing(h)
                    }}
                  >
                    수정
                  </button>
                  <button
                    className="text-btn danger"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation()
                      del(h.id)
                    }}
                  >
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 지급 */}
      <section className="acard">
        <span className="acap">조별 지급</span>
        {!selectedHint ? (
          <p className="aempty">왼쪽에서 힌트를 고르세요.</p>
        ) : (
          <>
            <div className="picked-hint">
              <span className={'grade g' + selectedHint.grade}>{selectedHint.grade}</span>
              <span className="hl">{selectedHint.headline}</span>
            </div>

            <p className="anote">
              R2부터는 [연도 넘기기]가 순위대로 <b>자동 배분</b>합니다(아래 미리보기). 여기서는 특정 힌트를
              특정 조에 <b>수동으로</b> 더 줄 수 있어요.
              {picked.length > 0 && (
                <button className="text-btn" onClick={() => setPicked([])} style={{ marginLeft: 6 }}>
                  선택 해제
                </button>
              )}
            </p>

            <div className="team-picks">
              {ranked.map((t, i) => {
                const has = selectedHint.granted_to.includes(t.code)
                const on = picked.includes(t.code)
                return (
                  <label key={t.code} className={'team-pick' + (has ? ' has' : '') + (on ? ' on' : '')}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={has}
                      onChange={(e) =>
                        setPicked((p) => (e.target.checked ? [...p, t.code] : p.filter((c) => c !== t.code)))
                      }
                    />
                    <span className="rk">{teams.length - i}위</span>
                    <span className="tn">{t.name}</span>
                    <span className="tc num">{t.code}</span>
                    <span className="te num">₩ {num(t.equity)}</span>
                    {has && (
                      <button
                        className="text-btn danger tiny"
                        onClick={(e) => {
                          e.preventDefault()
                          revoke(selectedHint.id, t.code)
                        }}
                      >
                        지급됨 · 취소
                      </button>
                    )}
                  </label>
                )
              })}
            </div>

            <button className="act-btn buy" disabled={busy || picked.length === 0} onClick={grant}>
              {picked.length}개 조에 지급
            </button>
          </>
        )}
      </section>

      {/* ── 자동 배분 미리보기 */}
      <section className="acard">
        <span className="acap">자동 배분 미리보기</span>
        {!preview ? (
          <p className="aempty">
            R2부터 [연도 넘기기] 때 순위대로 자동 배분됩니다. 지금은 미리 볼 라운드가 없어요.
          </p>
        ) : (
          <>
            <p className="anote">
              <b>R{preview.round}</b> 진입 시 예상 배분이에요 — <b>현재 순위 기준</b>. 힌트 풀을 등급순으로
              <b> 꼴찌부터 라운드로빈</b>해 전부 나눠줘요(하위권일수록 좋은 힌트 + 더 많이). 연도를 넘기면
              순위가 바뀌어 달라질 수 있어요.
            </p>
            {!preview.hasPool && (
              <p className="awarn">R{preview.round} 힌트가 아직 없어요. 먼저 힌트를 작성하세요.</p>
            )}
            <table>
              <thead>
                <tr>
                  <th>순위</th>
                  <th>조</th>
                  <th>평가금액</th>
                  <th>받을 힌트</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.code}>
                    <td className="num">{r.rank}위</td>
                    <td>{r.name}</td>
                    <td className="num">₩ {num(r.equity)}</td>
                    <td>
                      {r.grades.length === 0 ? (
                        <span className="sub">없음</span>
                      ) : (
                        <div className="pv-hints">
                          {r.grades.map((g, i) => (
                            <span key={i} className="pv-hint">
                              <span className={'grade g' + g}>{g}</span>
                              <span className="pv-hl">{r.headlines[i]}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {/* ── 작성·수정 */}
      <HintEditor
        hint={editing}
        stocks={stocks}
        rounds={rounds}
        busy={busy}
        onClose={() => setEditing(null)}
        onSave={save}
      />
    </div>
  )
}

function HintEditor({ hint, stocks, rounds, busy, onClose, onSave }) {
  const [draft, setDraft] = useState(hint)
  // hint가 바뀌면 폼을 다시 채운다
  const key = hint?.id ?? 'new'
  const cur = draft?.__key === key ? draft : { ...hint, __key: key }

  if (!hint) return null
  const set = (patch) => setDraft({ ...cur, ...patch })

  return (
    <Modal open onClose={onClose} title={hint.id ? '힌트 수정' : '힌트 작성'} wide>
      <div className="form">
        <div className="frow">
          <label>라운드</label>
          <div className="tabs mini">
            {rounds.map((r) => (
              <button key={r} className={cur.round === r ? 'on' : ''} onClick={() => set({ round: r })}>
                R{r}
              </button>
            ))}
          </div>
        </div>

        <div className="frow">
          <label>등급</label>
          <div className="tabs mini">
            {GRADES.map((g) => (
              <button key={g} className={cur.grade === g ? 'on' : ''} onClick={() => set({ grade: g })}>
                {g}
              </button>
            ))}
          </div>
        </div>

        <div className="frow">
          <label>영향</label>
          <div className="tabs mini">
            {IMPACTS.map((i) => (
              <button key={i.v} className={cur.impact === i.v ? 'on' : ''} onClick={() => set({ impact: i.v })}>
                {i.label}
              </button>
            ))}
          </div>
        </div>

        <div className="frow col">
          <label>헤드라인</label>
          <textarea
            rows={2}
            value={cur.headline}
            onChange={(e) => set({ headline: e.target.value })}
            placeholder="예: 메모리 감산 효과 가시화… 반도체 업황 바닥 통과 전망"
          />
        </div>

        <div className="frow col">
          <label>관련 종목 (없으면 전체 시장)</label>
          <div className="stock-picks">
            {stocks.map((s) => {
              const on = cur.related_stock_ids.includes(s.id)
              return (
                <button
                  key={s.id}
                  className={'chip' + (on ? ' on' : '')}
                  onClick={() =>
                    set({
                      related_stock_ids: on
                        ? cur.related_stock_ids.filter((x) => x !== s.id)
                        : [...cur.related_stock_ids, s.id],
                    })
                  }
                >
                  {s.name}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="mfoot">
        <button className="cancel" onClick={onClose}>
          취소
        </button>
        <button className="act-btn buy" disabled={busy || !cur.headline.trim()} onClick={() => onSave(cur)}>
          저장
        </button>
      </div>
    </Modal>
  )
}
