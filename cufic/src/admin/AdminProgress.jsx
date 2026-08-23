import { useEffect, useState } from 'react'
import Modal from '../components/Modal'
import TimerPill from '../components/RoundTimer'
import { errorText } from '../supabase'
import { checkContent } from '../dataCheck'
import { num } from '../format'

const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * 진행 탭. 라운드를 넘기는 순간이 대회의 유일한 되돌릴 수 없는 지점이므로
 * 확인 모달을 반드시 거치게 한다. 리셋은 텍스트 입력까지 요구한다 — 당일 오조작 방지.
 *
 * 게임 루프: [연도 넘기기]로 새 가격·순위를 공개하고 → 순위를 확인한 뒤 →
 * [타이머 시작]으로 거래를 연다. 10분이 지나면 거래는 자동으로 닫히고, 관리자가 다시 연도를 넘긴다.
 */
export default function AdminProgress({
  actions,
  game,
  teams,
  gamePin,
  stocks = [],
  hints = [],
  financials = [],
  macro = [],
  broadcasts = [],
  refresh,
  notify,
}) {
  const [confirm, setConfirm] = useState(null) // 'advance' | 'end' | 'reset'
  const [resetText, setResetText] = useState('')
  const [busy, setBusy] = useState(false)
  const [pinBusy, setPinBusy] = useState(false)
  const [nowTs, setNowTs] = useState(() => Date.now())
  const [bcText, setBcText] = useState('') // 속보 입력
  const [issues, setIssues] = useState(null) // [데이터 점검] 결과
  const [cfg, setCfg] = useState(null) // 게임 설정 편집 상태
  const [dsList, setDsList] = useState([]) // 저장된 데이터셋 목록 (시작 전 선택용)
  const [dsTarget, setDsTarget] = useState(null) // 바꾸려는 데이터셋 {id, name}

  // 카운트다운 1초 틱
  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // 데이터셋 목록 (진행 탭에서 시작 전에 고를 수 있게)
  useEffect(() => {
    actions.listDatasets().then((r) => {
      if (r.ok) setDsList(r.datasets ?? [])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!game) return null

  const cur = game.current_round
  const total = game.total_rounds
  const isLast = cur >= total
  const notStarted = cur === 0
  const nextYear = game.round_year_map?.[String(cur + 1)]

  // 시작 전 데이터셋 선택 (game.active_dataset_id = 지금 사용 중인 한 벌)
  const activeDsId = game.active_dataset_id ?? null
  const activeDs = dsList.find((d) => d.id === activeDsId) ?? null

  // 거래 타이머 상태 (서버 round_ends_at 기준)
  const endsAt = game.round_ends_at ? new Date(game.round_ends_at).getTime() : null
  const remainingMs = endsAt ? Math.max(0, endsAt - nowTs) : 0
  const timerRunning = !notStarted && remainingMs > 0
  const durMin = Math.round((game.round_duration_seconds ?? 600) / 60)
  const durationMs = (game.round_duration_seconds ?? 600) * 1000
  const openMode = game.join_mode === 'open'

  const traded = teams.filter((t) => Number(t.trades_this_round) > 0)

  const run = async (fn, okMsg) => {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    setConfirm(null)
    setResetText('')
    if (!r.ok) {
      notify(errorText(r.error), 'down')
      return
    }
    notify(okMsg, 'gold')
    await refresh()
  }

  const sendBc = async () => {
    const t = bcText.trim()
    if (!t) return
    setBusy(true)
    const r = await actions.sendBroadcast(t)
    setBusy(false)
    if (!r.ok) {
      notify(errorText(r.error), 'down')
      return
    }
    setBcText('')
    notify('속보를 전체 발송했어요', 'gold')
    await refresh()
  }

  const delBc = async (id) => {
    const r = await actions.deleteBroadcast(id)
    if (!r.ok) {
      notify(errorText(r.error), 'down')
      return
    }
    await refresh()
  }

  // 공용 게임 PIN 발급/재발급 (자율 입장)
  const issuePin = async () => {
    setPinBusy(true)
    const r = await actions.setGamePin()
    setPinBusy(false)
    if (!r.ok) return notify(errorText(r.error), 'down')
    notify('입장 PIN을 발급했어요: ' + r.game_pin, 'gold')
    await refresh()
  }

  // 대회 시작 — 자율 입장인데 PIN이 없으면 학생이 못 들어오므로 막는다(가드)
  const tryStart = () => {
    if (openMode && !gamePin) {
      notify('입장 PIN을 먼저 발급하세요 — 지금 시작하면 학생이 못 들어와요', 'down')
      return
    }
    setConfirm('advance')
  }

  // 라운드 시간 = 게임 설정의 타이머(round_duration_seconds → durMin). 미세 조정은 아래 ±1분 버튼으로.
  const startTimerNow = async () => {
    setBusy(true)
    const r = await actions.startTimer(durMin)
    setBusy(false)
    if (!r.ok) {
      notify(errorText(r.error), 'down')
      return
    }
    notify(timerRunning ? `타이머를 다시 시작했어요 (${durMin}분)` : `거래를 열었어요 (${durMin}분)`, 'gold')
    await refresh()
  }

  // 진행 중인 타이머를 ±1분 조정
  const adjustTimer = async (deltaMin) => {
    setBusy(true)
    const r = await actions.adjustTimer(deltaMin * 60)
    setBusy(false)
    if (!r.ok) {
      notify(errorText(r.error), 'down')
      return
    }
    notify(`거래 시간 ${deltaMin > 0 ? '+' : ''}${deltaMin}분`, 'gold')
    await refresh()
  }

  // 연도 넘기기 — 자동 힌트 배분 결과·부족 경고를 함께 알린다
  const doAdvance = async () => {
    setBusy(true)
    const r = await actions.advanceRound()
    setBusy(false)
    setConfirm(null)
    if (!r.ok) {
      notify(errorText(r.error), 'down')
      return
    }
    const granted = Number(r.hints?.granted ?? 0)
    const warns = r.hints?.warnings ?? []
    notify(granted > 0 ? `라운드가 넘어갔어요 · 힌트 ${granted}건 자동 배분` : '라운드가 넘어갔어요', 'gold')
    if (warns.length > 0) {
      const grades = [...new Set(warns.map((w) => w.grade))].join('·')
      notify(`⚠ ${grades} 등급 힌트 부족 — 인접 등급으로 대체됐어요`, 'down')
    }
    await refresh()
  }

  // 데이터셋 바꾸기 — 드롭다운에서 다른 걸 고르면 확인 후 불러온다(게임 리셋, 조 유지)
  const askSwitchDs = (idRaw) => {
    const id = Number(idRaw) // select 값은 문자열, 데이터셋 id는 숫자
    if (!id || id === Number(activeDsId)) return
    const d = dsList.find((x) => Number(x.id) === id)
    if (!d) return
    setDsTarget({ id: d.id, name: d.name })
    setConfirm('switchDs')
  }
  const doSwitchDs = async () => {
    if (!dsTarget) return
    const t = dsTarget
    setBusy(true)
    const r = await actions.loadDataset(t.id)
    setBusy(false)
    setConfirm(null)
    setDsTarget(null)
    if (!r.ok) return notify(errorText(r.error), 'down')
    notify(`'${t.name}' 데이터셋으로 세팅했어요`, 'gold')
    const lr = await actions.listDatasets()
    if (lr.ok) setDsList(lr.datasets ?? [])
    await refresh()
  }

  const runCheck = () => setIssues(checkContent(game, stocks, hints, financials, macro))

  // ── 게임 설정 편집 (시작 전에만)
  const startCfg = () =>
    setCfg({
      totalRounds: game.total_rounds,
      years: Object.fromEntries(
        Array.from({ length: game.total_rounds }, (_, i) => [
          i + 1,
          game.round_year_map?.[String(i + 1)] ?? '',
        ]),
      ),
      finalYear: game.final_year ?? '',
      defaultSeed: game.default_seed ?? 100000000,
      durationMinutes: Math.round((game.round_duration_seconds ?? 600) / 60),
      joinMode: game.join_mode ?? 'code',
    })
  const setCfgYear = (r, v) => setCfg((c) => ({ ...c, years: { ...c.years, [r]: v } }))
  const setTotal = (n) => {
    const t = Math.max(1, Math.min(20, Number(n) || 1))
    setCfg((c) => {
      const years = {}
      for (let r = 1; r <= t; r++) years[r] = c.years[r] ?? ''
      return { ...c, totalRounds: t, years }
    })
  }
  const saveCfg = async () => {
    const roundYearMap = {}
    for (let r = 1; r <= cfg.totalRounds; r++) roundYearMap[r] = Number(cfg.years[r])
    setBusy(true)
    const res = await actions.updateGameConfig({
      totalRounds: cfg.totalRounds,
      roundYearMap,
      finalYear: Number(cfg.finalYear),
      defaultSeed: Number(cfg.defaultSeed),
      durationMinutes: Number(cfg.durationMinutes),
      joinMode: cfg.joinMode,
    })
    setBusy(false)
    if (!res.ok) return notify(errorText(res.error), 'down')
    setCfg(null)
    notify('게임 설정을 저장했어요', 'gold')
    await refresh()
  }

  // 다음 할 일 — 상태 기반으로 지금 눌러야 할 버튼 하나를 강조.
  // id는 현재 라운드 카드와의 버튼 중복을 막는 데 쓴다(같은 버튼은 한 곳에서만).
  let nextAction = null
  if (notStarted)
    nextAction = { id: 'advance', label: '대회 시작', msg: '학생 입장 확인 후 시작하세요', run: () => setConfirm('advance') }
  else if (!endsAt)
    nextAction = { id: 'timer', label: '타이머 시작', msg: '타이머를 시작해야 매매가 열려요', run: startTimerNow }
  else if (timerRunning) nextAction = null // 진행 중엔 타이머 카드가 주인공
  else if (isLast)
    nextAction = { id: 'end', label: '대회 종료', msg: '마지막 라운드예요. 종료하면 최종 정산됩니다', run: () => setConfirm('end') }
  else
    nextAction = { id: 'advance', label: '다음 연도로', msg: '정산하면 순위가 갱신되고 힌트가 나갑니다', run: () => setConfirm('advance') }

  // 현재 라운드 카드의 큰 버튼은 '다음 할 일'이 같은 버튼을 이미 보이면 숨긴다(출처 한 곳).
  const roundCardActionId = isLast ? 'end' : 'advance'
  const showRoundBtn = !(nextAction && nextAction.id === roundCardActionId)

  return (
    <div className="apanel">
      {/* 시작 전: 대회 준비 — 순서대로 ①데이터셋 ②입장 PIN ③입장 확인 ④대회 시작 */}
      {notStarted && (
        <section className="acard prep-card">
          <span className="acap">대회 준비 — 순서대로</span>

          {/* ① 데이터셋 */}
          <div className="prep-step">
            <span className="prep-no">①</span>
            <div className="prep-body">
              <span className="prep-t">데이터셋 선택</span>
              <div className="ds-pick-row">
                <select
                  className="ds-pick-sel"
                  value={activeDsId ?? ''}
                  disabled={busy || dsList.length === 0}
                  onChange={(e) => askSwitchDs(e.target.value)}
                >
                  {dsList.length === 0 ? (
                    <option value="">저장된 데이터셋이 없어요 — [데이터셋] 탭에서 먼저 저장</option>
                  ) : (
                    <>
                      {activeDsId == null && <option value="">데이터셋 선택…</option>}
                      {dsList.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </>
                  )}
                </select>
                {activeDs?.description && <span className="ds-pick-desc">{activeDs.description}</span>}
              </div>
              <span className="anote">고른 내용으로 게임이 세팅됩니다(조 유지 · 저장 안 한 편집은 사라짐). 만들기·백업은 [데이터셋] 탭.</span>
            </div>
          </div>

          {/* ② 입장 안내 — 자율 입장이면 게임 PIN, 코드 방식이면 코드 배부 */}
          <div className="prep-step">
            <span className="prep-no">②</span>
            <div className="prep-body">
              {openMode ? (
                <>
                  <span className="prep-t">입장 PIN 발급</span>
                  <div className="gamepin-row">
                    <span className="gamepin-val num">{gamePin || '– – – –'}</span>
                    <button className="act-btn prime" disabled={pinBusy} onClick={issuePin}>
                      {gamePin ? 'PIN 재발급' : 'PIN 발급'}
                    </button>
                  </div>
                  <span className="anote">
                    {gamePin ? '학생들에게 이 번호를 알려주세요. 학생은 닉네임 + 이 PIN으로 입장합니다.' : '아직 PIN이 없어요 — [PIN 발급]으로 만들고 학생에게 알려주세요.'}
                  </span>
                </>
              ) : (
                <>
                  <span className="prep-t">참가 코드 배부</span>
                  <span className="anote">코드 방식이에요. [조 관리] 탭에서 조·코드를 만들어 학생에게 나눠주세요. (입장 방식은 아래 게임 설정에서 변경)</span>
                </>
              )}
            </div>
          </div>

          {/* ③ 입장 확인 */}
          <div className="prep-step">
            <span className="prep-no">③</span>
            <div className="prep-body">
              <span className="prep-t">입장 확인</span>
              <span className={teams.length > 0 ? 'aok' : 'anote'}>
                {teams.length > 0
                  ? `지금 ${teams.length}개 조 입장함`
                  : openMode
                    ? '아직 입장한 조가 없어요 — 학생이 PIN으로 입장하면 실시간으로 늘어나요'
                    : '아직 만든 조가 없어요 — [조 관리] 탭에서 추가하세요'}
              </span>
            </div>
          </div>

          {/* ④ 대회 시작 */}
          <div className="prep-step">
            <span className="prep-no">④</span>
            <div className="prep-body">
              <button className="act-btn prime prep-start" disabled={busy} onClick={tryStart}>
                대회 시작 (ROUND 1 열기)
              </button>
              <span className="anote">누르면 ROUND 1이 열리고, 학생 새 입장은 마감됩니다(재접속만 가능).</span>
            </div>
          </div>
        </section>
      )}

      {nextAction && !notStarted && (
        <section className="acard next-action">
          <div className="na-info">
            <span className="na-label">다음 할 일</span>
            <span className="na-msg">{nextAction.msg}</span>
          </div>
          <button className="act-btn prime na-btn" disabled={busy} onClick={nextAction.run}>
            {nextAction.label}
          </button>
        </section>
      )}
      {!notStarted && (
        <section className="acard big">
          <span className="acap">현재 라운드</span>
          <div className="round-big">
            <b>
              ROUND {cur} · {game.round_year_map?.[String(cur)]}년
            </b>
            <span>
              전체 {total}라운드 중 {cur}번째
            </span>
          </div>

          {showRoundBtn && (
            <div className="arow">
              {!isLast ? (
                <button className="act-btn prime" disabled={busy} onClick={() => setConfirm('advance')}>
                  다음 연도로 넘어가기 (순위 갱신)
                </button>
              ) : (
                <button className="act-btn danger" disabled={busy} onClick={() => setConfirm('end')}>
                  대회 종료
                </button>
              )}
            </div>
          )}

          {!isLast && (
            <p className="anote">
              누르면 <b>{nextYear}년 가격이 공개</b>되고 보유종목이 재평가돼 <b>순위가 갱신</b>되며,
              새 순위로 <b>힌트가 자동 배분</b>됩니다(하위권 우대). 순위를 확인한 뒤 아래에서
              <b>타이머를 시작</b>하면 거래가 열립니다. 되돌릴 수 없습니다.
            </p>
          )}
        </section>
      )}

      {/* 거래 타이머 — 순위 확인 후 여기서 거래를 연다 */}
      {!notStarted && (
        <section className="acard big">
          <span className="acap">거래 타이머</span>
          <TimerPill
            remainingMs={remainingMs}
            durationMs={durationMs}
            state={timerRunning ? 'live' : endsAt ? 'closed' : 'waiting'}
          />
          <p className="anote">
            {timerRunning
              ? '거래 진행 중 — 학생들이 매매할 수 있어요'
              : endsAt
                ? '거래 마감 — 순위 확인 후 다음 연도로 넘기세요'
                : `타이머를 시작하면 ${durMin}분간 거래가 열려요`}
          </p>
          {timerRunning && (
            <div className="timer-adjust">
              <button className="act-btn adj" disabled={busy} onClick={() => adjustTimer(-1)}>
                − 1분
              </button>
              <span className="adj-hint">거래 시간 조정</span>
              <button className="act-btn adj" disabled={busy} onClick={() => adjustTimer(1)}>
                + 1분
              </button>
            </div>
          )}
          <div className="arow">
            <button className="act-btn prime" disabled={busy} onClick={startTimerNow}>
              {timerRunning ? `타이머 다시 시작 (${durMin}분)` : `타이머 시작 (${durMin}분)`}
            </button>
          </div>
        </section>
      )}

      {/* 속보 · 공통 힌트 — 전체 조에 즉시 발송 */}
      <section className="acard">
        <span className="acap">속보 · 공통 힌트 (전체 발송)</span>
        <p className="anote">전 조 화면에 종 알림으로 즉시 뜹니다. 조별 등급 힌트와 별개예요.</p>
        <div className="bc-send">
          <input
            className="bc-input"
            value={bcText}
            onChange={(e) => setBcText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendBc()}
            placeholder="예: 미국 금리 동결 발표 — 성장주 반등 기대"
            maxLength={120}
          />
          <button className="act-btn prime bc-go" disabled={busy || !bcText.trim()} onClick={sendBc}>
            전체 발송
          </button>
        </div>
        {broadcasts.length > 0 && (
          <div className="bc-sent">
            {broadcasts.map((b) => (
              <div key={b.id} className="bc-sent-row">
                <span className="bc-sent-head">{b.headline}</span>
                <span className="bc-sent-meta">R{b.round}</span>
                <button
                  className="text-btn danger tiny"
                  disabled={busy}
                  onClick={() => delBc(b.id)}
                >
                  회수
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 거래 현황 — 이번 라운드에 누가 매매했는지 */}
      {!notStarted && (
        <section className="acard">
          <span className="acap">이번 라운드 거래 현황</span>
          {teams.length === 0 ? (
            <p className="aempty">등록된 조가 없습니다.</p>
          ) : (
            <>
              <p className={traded.length === teams.length ? 'aok' : 'anote'}>
                거래한 조 {traded.length} / {teams.length}
              </p>
              {traded.length > 0 && (
                <div className="chips">
                  {traded.map((t) => (
                    <span key={t.code} className="chip">
                      {t.name} · {Number(t.trades_this_round)}건
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ── 여기부터 대회 준비 영역 */}
      <div className="group-sep">
        <span>대회 준비</span>
      </div>

      {/* 게임 설정 — 시작 전에만 */}
      {notStarted && (
        <section className="acard">
          <span className="acap">게임 설정 (시작 전에만)</span>
          {!cfg ? (
            <>
              <p className="anote">
                라운드 {game.total_rounds}개 · 연도 {Object.values(game.round_year_map ?? {}).join('·')} ·
                최종 {game.final_year} · 기본 시드 ₩{num(game.default_seed)} · 타이머{' '}
                {Math.round((game.round_duration_seconds ?? 600) / 60)}분 · 입장{' '}
                {game.join_mode === 'open' ? '자율(닉네임)' : '코드'}
              </p>
              <button className="text-btn" onClick={startCfg}>
                설정 편집
              </button>
            </>
          ) : (
            <div className="cfg-form">
              <div className="frow col">
                <label>라운드 수</label>
                <input
                  className="num"
                  type="number"
                  min="1"
                  max="20"
                  value={cfg.totalRounds}
                  onChange={(e) => setTotal(e.target.value)}
                />
              </div>
              <div className="frow col">
                <label>라운드별 연도</label>
                <div className="cfg-years">
                  {Array.from({ length: cfg.totalRounds }, (_, i) => i + 1).map((r) => (
                    <div key={r} className="pcell">
                      <span>R{r}</span>
                      <input
                        className="num"
                        type="number"
                        value={cfg.years[r]}
                        onChange={(e) => setCfgYear(r, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div className="frow two">
                <div className="frow col">
                  <label>최종 정산 연도</label>
                  <input
                    className="num"
                    type="number"
                    value={cfg.finalYear}
                    onChange={(e) => setCfg({ ...cfg, finalYear: e.target.value })}
                  />
                </div>
                <div className="frow col">
                  <label>기본 시드머니</label>
                  <input
                    className="num"
                    type="number"
                    value={cfg.defaultSeed}
                    onChange={(e) => setCfg({ ...cfg, defaultSeed: e.target.value })}
                  />
                </div>
                <div className="frow col">
                  <label>타이머(분)</label>
                  <input
                    className="num"
                    type="number"
                    value={cfg.durationMinutes}
                    onChange={(e) => setCfg({ ...cfg, durationMinutes: e.target.value })}
                  />
                </div>
              </div>
              <div className="frow col">
                <label>입장 방식</label>
                <div className="tabs mini">
                  <button
                    className={cfg.joinMode === 'code' ? 'on' : ''}
                    onClick={() => setCfg({ ...cfg, joinMode: 'code' })}
                  >
                    코드 (강사가 조·코드 배부)
                  </button>
                  <button
                    className={cfg.joinMode === 'open' ? 'on' : ''}
                    onClick={() => setCfg({ ...cfg, joinMode: 'open' })}
                  >
                    자율 (학생이 닉네임으로 입장)
                  </button>
                </div>
                <span className="anote">
                  자율: 학생이 닉네임을 정하면 그 자리에서 조가 생기고 재접속용 PIN이 발급돼요. 새 입장은 시작 전에만.
                </span>
              </div>
              <div className="arow">
                <button className="text-btn" onClick={() => setCfg(null)}>
                  취소
                </button>
                <button className="act-btn prime" disabled={busy} onClick={saveCfg}>
                  설정 저장
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* 데이터 점검 */}
      <section className="acard">
        <span className="acap">데이터 점검</span>
        <p className="anote">
          힌트 호재/악재↔실제 등락 · 힌트 누락 · 가격 공백 등 콘텐츠 정합성을 검사해요.
        </p>
        <button className="act-btn neutral" disabled={busy} onClick={runCheck}>
          데이터 점검 실행
        </button>
      </section>

      <details className="acard danger reset-card">
        <summary className="acap">게임 리셋 (펼쳐서 실행)</summary>
        <p className="anote">
          모든 조의 예수금이 초기 자본으로 돌아가고 보유·체결내역·힌트 지급이 전부 사라집니다. 종목과
          힌트 등 콘텐츠는 남습니다.
        </p>
        <button className="text-btn danger" disabled={busy} onClick={() => setConfirm('reset')}>
          게임 리셋
        </button>
      </details>

      {/* 라운드 진행 확인 */}
      <Modal open={confirm === 'advance'} onClose={() => setConfirm(null)} title="확인">
        <div className="confirm">
          <p className="big">
            {notStarted ? (
              <>
                <b>ROUND 1 · {game.round_year_map?.['1']}년</b>으로 대회를 시작합니다
              </>
            ) : (
              <>
                <b>
                  ROUND {cur + 1} · {nextYear}년
                </b>
                으로 넘어갑니다
              </>
            )}
          </p>
          <p className="ask">모든 조에 즉시 반영됩니다. 되돌릴 수 없습니다.</p>
          {timerRunning && (
            <p className="sheet-warn">
              아직 거래 타이머가 {mmss(remainingMs)} 남아 있습니다. 넘기면 거래가 바로 닫힙니다.
            </p>
          )}
        </div>
        <div className="mfoot">
          <button className="cancel" onClick={() => setConfirm(null)}>
            취소
          </button>
          <button className="act-btn prime" disabled={busy} onClick={doAdvance}>
            {busy ? '진행 중…' : '진행'}
          </button>
        </div>
      </Modal>

      {/* 대회 종료 */}
      <Modal open={confirm === 'end'} onClose={() => setConfirm(null)} title="대회 종료">
        <div className="confirm">
          <p className="big">대회를 종료합니다</p>
          <p className="ask">최종 순위가 기록됩니다.</p>
        </div>
        <div className="mfoot">
          <button className="cancel" onClick={() => setConfirm(null)}>
            취소
          </button>
          <button
            className="act-btn danger"
            disabled={busy}
            onClick={() => run(actions.endGame, '대회가 종료되었습니다')}
          >
            종료
          </button>
        </div>
      </Modal>

      {/* 리셋 — 이중 확인 */}
      <Modal open={confirm === 'reset'} onClose={() => setConfirm(null)} title="게임 리셋">
        <div className="confirm">
          <p className="big">정말 초기화할까요?</p>
          <p className="ask">
            모든 조의 거래가 사라집니다. 되돌릴 수 없습니다.
            <br />
            확인을 위해 <b>RESET</b>을 입력하세요.
          </p>
          <input
            className="reset-input num"
            value={resetText}
            onChange={(e) => setResetText(e.target.value)}
            placeholder="RESET"
            autoFocus
          />
        </div>
        <div className="mfoot">
          <button className="cancel" onClick={() => setConfirm(null)}>
            취소
          </button>
          <button
            className="act-btn danger"
            disabled={busy || resetText !== 'RESET'}
            onClick={() => run(actions.resetGame, '게임이 초기화되었습니다')}
          >
            초기화
          </button>
        </div>
      </Modal>

      {/* 데이터셋 바꾸기 확인 */}
      <Modal
        open={confirm === 'switchDs'}
        onClose={() => {
          setConfirm(null)
          setDsTarget(null)
        }}
        title="데이터셋 바꾸기"
      >
        <div className="confirm">
          <p className="big">
            <b>'{dsTarget?.name}'</b> 데이터셋으로 세팅합니다
          </p>
          <p className="ask">
            지금 콘텐츠가 이 데이터셋으로 바뀝니다. 조는 유지되고, <b>저장하지 않은 편집은 사라져요.</b>
          </p>
        </div>
        <div className="mfoot">
          <button
            className="cancel"
            onClick={() => {
              setConfirm(null)
              setDsTarget(null)
            }}
          >
            취소
          </button>
          <button className="act-btn prime" disabled={busy} onClick={doSwitchDs}>
            {busy ? '세팅 중…' : '이 데이터셋으로'}
          </button>
        </div>
      </Modal>

      {/* 데이터 점검 결과 */}
      <Modal open={issues !== null} onClose={() => setIssues(null)} title="데이터 점검 결과" wide>
        {issues && issues.length === 0 ? (
          <p className="aok">문제를 찾지 못했어요. 데이터가 정합적이에요 ✅</p>
        ) : (
          <ul className="issue-list">
            {(issues ?? []).map((it, i) => (
              <li key={i} className={'issue ' + it.level}>
                <span className="ilv">
                  {it.level === 'error' ? '오류' : it.level === 'warn' ? '경고' : '참고'}
                </span>
                {it.msg}
              </li>
            ))}
          </ul>
        )}
        <div className="mfoot">
          <button className="act-btn neutral" onClick={() => setIssues(null)}>
            닫기
          </button>
        </div>
      </Modal>
    </div>
  )
}
