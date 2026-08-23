import { useState } from 'react'
import Modal from '../components/Modal'
import { errorText } from '../supabase'
import { num, signed, pct, dirOf } from '../format'

/**
 * 조 관리 탭. 입장 방식(game.join_mode)에 따라 모양이 다르다 —
 *   · code: 강사가 참가 코드로 조를 직접 만든다(코드 열 + [조 추가]).
 *   · open: 학생이 닉네임 + 공용 게임 PIN으로 직접 입장한다. 강사는 PIN 발급·모니터·이름 교정·삭제만.
 * 조 수·시드는 전부 여기서 정한다 — 코드에 하드코딩하지 않는다.
 */
export default function AdminTeams({ actions, game, teams, gamePin, refresh, notify }) {
  const [adding, setAdding] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [busy, setBusy] = useState(false)
  const [pinBusy, setPinBusy] = useState(false)
  const [form, setForm] = useState({ code: '', name: '', seed: '' })
  const [seedEdit, setSeedEdit] = useState({}) // code → 입력 중인 시드
  const [nameEdit, setNameEdit] = useState({}) // code → 입력 중인 이름

  const started = (game?.current_round ?? 0) > 0
  const defaultSeed = Number(game?.default_seed ?? 0)
  const openMode = game?.join_mode === 'open' // 자율 입장

  // 접속 표시 — 최근 로그인 시각 기반. 10분 안이면 "접속"(초록), 오래됐으면 시각만, 없으면 미접속.
  const loginStatus = (t) => {
    if (!t.last_login_at) return { txt: '미접속', cls: 'off' }
    const mins = (Date.now() - new Date(t.last_login_at).getTime()) / 60000
    const time = new Date(t.last_login_at).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
    })
    return mins < 10 ? { txt: '접속 · ' + time, cls: 'on' } : { txt: '이전 접속 ' + time, cls: 'old' }
  }

  const issuePin = async () => {
    setPinBusy(true)
    const r = await actions.setGamePin()
    setPinBusy(false)
    if (!r.ok) return notify(errorText(r.error), 'down')
    notify('게임 입장 PIN을 발급했어요: ' + r.game_pin, 'gold')
    await refresh()
  }

  const add = async () => {
    setBusy(true)
    const r = await actions.createTeam(
      form.code,
      form.name,
      form.seed ? Number(form.seed.replace(/\D/g, '')) : null,
    )
    setBusy(false)
    if (!r.ok) return notify(errorText(r.error), 'down')
    setAdding(false)
    setForm({ code: '', name: '', seed: '' })
    notify('조를 추가했어요', 'gold')
    await refresh()
  }

  const del = async (code) => {
    setBusy(true)
    const r = await actions.deleteTeam(code)
    setBusy(false)
    setConfirmDel(null)
    if (!r.ok) return notify(errorText(r.error), 'down')
    notify('조를 삭제했어요', 'gold')
    await refresh()
  }

  const saveSeed = async (code) => {
    const v = Number((seedEdit[code] ?? '').replace(/\D/g, ''))
    if (!v) return
    const r = await actions.setTeamSeed(code, v)
    if (!r.ok) return notify(errorText(r.error), 'down')
    setSeedEdit((s) => ({ ...s, [code]: undefined }))
    notify('시드를 바꿨어요', 'gold')
    await refresh()
  }

  const saveName = async (code) => {
    const v = (nameEdit[code] ?? '').trim()
    if (v.length < 2) return notify('이름은 2~12자로 입력해 주세요', 'down')
    const r = await actions.renameTeam(code, v)
    if (!r.ok) return notify(errorText(r.error), 'down')
    setNameEdit((s) => ({ ...s, [code]: undefined }))
    notify('이름을 바꿨어요', 'gold')
    await refresh()
  }

  const nameCell = (t) =>
    nameEdit[t.code] !== undefined ? (
      <span className="seed-edit">
        <input
          value={nameEdit[t.code]}
          maxLength={12}
          onChange={(e) => setNameEdit((s) => ({ ...s, [t.code]: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && saveName(t.code)}
          autoFocus
        />
        <button className="text-btn tiny" onClick={() => saveName(t.code)}>
          저장
        </button>
      </span>
    ) : (
      <button
        className="linkish"
        title="이름 수정"
        onClick={() => setNameEdit((s) => ({ ...s, [t.code]: t.name }))}
      >
        {t.name}
      </button>
    )

  return (
    <div className="apanel">
      {/* ── 자율 입장: 공용 게임 PIN 카드 ── */}
      {openMode && (
        <section className="acard gamepin-card">
          <div className="acard-head">
            <span className="acap">게임 입장 PIN</span>
          </div>
          <div className="gamepin-row">
            <span className="gamepin-val num">{gamePin || '– – – –'}</span>
            <button className="act-btn prime" disabled={pinBusy} onClick={issuePin}>
              {gamePin ? 'PIN 재발급' : 'PIN 발급'}
            </button>
          </div>
          <p className="anote">
            {gamePin
              ? '학생에게 이 PIN을 알려주세요. 학생은 닉네임 + 이 PIN으로 입장합니다.'
              : '아직 PIN이 없어 학생이 입장할 수 없어요. [PIN 발급]으로 만들고 학생에게 알려주세요.'}
          </p>
        </section>
      )}

      <section className="acard">
        <div className="acard-head">
          <span className="acap">조 목록 ({teams.length}조)</span>
          {!openMode && (
            <button className="text-btn" onClick={() => setAdding(true)}>
              + 조 추가
            </button>
          )}
        </div>

        {openMode && (
          <p className="anote">
            자율 입장 모드 — 학생이 <b>닉네임 + 게임 PIN</b>으로 직접 입장합니다. (입장 방식 변경: [진행] →
            게임 설정){' '}
            {started ? (
              <span className="chip">입장 마감 · 재접속만</span>
            ) : (
              <span className="chip ok">입장 열림</span>
            )}
          </p>
        )}

        {started && (
          <p className="anote">대회가 시작되어 시드는 바꿀 수 없습니다. 초기화하면 다시 바꿀 수 있습니다.</p>
        )}

        {teams.length === 0 ? (
          <p className="aempty">
            {openMode
              ? '아직 입장한 학생이 없어요. 학생이 닉네임 + PIN으로 입장하면 여기 실시간으로 나타납니다.'
              : '등록된 조가 없습니다. [조 추가]로 시작하세요.'}
          </p>
        ) : (
          <div className="scroller">
            <table>
              <thead>
                <tr>
                  {!openMode && <th>코드</th>}
                  <th>이름</th>
                  <th>시드</th>
                  <th>예수금</th>
                  <th>평가금액</th>
                  <th>수익률</th>
                  <th>거래</th>
                  <th>힌트</th>
                  <th>접속</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => {
                  const editing = seedEdit[t.code] !== undefined
                  return (
                    <tr key={t.code}>
                      {!openMode && <td className="num">{t.code}</td>}
                      <td>{nameCell(t)}</td>
                      <td className="num">
                        {started ? (
                          num(t.seed)
                        ) : editing ? (
                          <span className="seed-edit">
                            <input
                              className="num"
                              value={seedEdit[t.code]}
                              onChange={(e) => setSeedEdit((s) => ({ ...s, [t.code]: e.target.value }))}
                              onKeyDown={(e) => e.key === 'Enter' && saveSeed(t.code)}
                              autoFocus
                            />
                            <button className="text-btn tiny" onClick={() => saveSeed(t.code)}>
                              저장
                            </button>
                          </span>
                        ) : (
                          <button
                            className="linkish num"
                            onClick={() => setSeedEdit((s) => ({ ...s, [t.code]: String(t.seed) }))}
                          >
                            {num(t.seed)}
                          </button>
                        )}
                      </td>
                      <td className="num">{num(t.cash)}</td>
                      <td className="num">{num(t.equity)}</td>
                      <td className={'num ' + dirOf(Number(t.pnl))}>
                        {pct(Number(t.pnl_pct))}
                        <div className="sub" style={{ color: 'inherit' }}>
                          {signed(Number(t.pnl))}
                        </div>
                      </td>
                      <td>
                        {Number(t.trades_this_round) > 0 ? (
                          <span className="chip ok">{Number(t.trades_this_round)}건</span>
                        ) : (
                          <span className="chip">—</span>
                        )}
                      </td>
                      <td className="num">{t.hint_count}</td>
                      <td>
                        <span className={'conn ' + loginStatus(t).cls}>{loginStatus(t).txt}</span>
                      </td>
                      <td>
                        <button className="text-btn danger tiny" onClick={() => setConfirmDel(t)}>
                          삭제
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal open={adding} onClose={() => setAdding(false)} title="조 추가">
        <div className="form">
          <div className="frow col">
            <label>참가 코드</label>
            <input
              className="num"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="TIGER-03"
              autoFocus
            />
          </div>
          <div className="frow col">
            <label>조 이름</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="호랑이 3조"
            />
          </div>
          <div className="frow col">
            <label>시드머니 (비우면 기본값 {num(defaultSeed)})</label>
            <input
              className="num"
              value={form.seed}
              onChange={(e) => setForm({ ...form, seed: e.target.value })}
              placeholder={String(defaultSeed)}
            />
          </div>
        </div>
        <div className="mfoot">
          <button className="cancel" onClick={() => setAdding(false)}>
            취소
          </button>
          <button className="act-btn buy" disabled={busy || !form.code.trim()} onClick={add}>
            추가
          </button>
        </div>
      </Modal>

      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="조 삭제">
        {confirmDel && (
          <div className="confirm">
            <p className="big">
              <b>{confirmDel.name}</b>
              {!openMode && <> ({confirmDel.code})</>}
            </p>
            <p className="ask">이 조의 보유·체결내역·힌트가 전부 사라집니다. 되돌릴 수 없습니다.</p>
          </div>
        )}
        <div className="mfoot">
          <button className="cancel" onClick={() => setConfirmDel(null)}>
            취소
          </button>
          <button className="act-btn sell" disabled={busy} onClick={() => del(confirmDel.code)}>
            삭제
          </button>
        </div>
      </Modal>
    </div>
  )
}
