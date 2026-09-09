import { useEffect, useState } from 'react'
import Modal from '../components/Modal'
import TimerPill from '../components/RoundTimer'
import { errorText } from '../supabase'

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
// 한 연도의 시세 경로 출처를 한 줄 뱃지로. 엔진(수학)·브리지(엑셀)·혼합 구분.
function SourceBadge({ info }) {
  if (!info || !info.total) return <span className="src-badge none">시세 경로 없음</span>
  if (info.engine && !info.bridge)
    return <span className="src-badge engine">🧮 수학엔진 ({info.engine})</span>
  if (info.bridge && !info.engine)
    return <span className="src-badge bridge">📊 엑셀·브리지 ({info.bridge})</span>
  return (
    <span className="src-badge mixed">
      ⚠ 혼합 — 엔진 {info.engine} · 브리지 {info.bridge}
    </span>
  )
}

export default function AdminProgress({
  actions,
  game,
  teams,
  gamePin,
  broadcasts = [],
  pathSources = {},
  refresh,
  notify,
}) {
  const [confirm, setConfirm] = useState(null) // 'advance' | 'end' | 'switchDs'
  const [busy, setBusy] = useState(false)
  const [pinBusy, setPinBusy] = useState(false)
  const [nowTs, setNowTs] = useState(() => Date.now())
  const [bcText, setBcText] = useState('') // 속보 입력
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
  const pausedAt = game.round_paused_at ? new Date(game.round_paused_at).getTime() : null
  const paused = pausedAt != null
  const remainingMs = endsAt ? Math.max(0, endsAt - (pausedAt ?? nowTs)) : 0
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

  // 종가 단일가 체결 모드 진행 중 토글 (0051)
  const setFlat = async (v) => {
    if (v === !!game.flat_pricing) return
    setBusy(true)
    const r = await actions.setFlatPricing(v)
    setBusy(false)
    if (!r.ok) {
      notify(errorText(r.error), 'down')
      return
    }
    notify(v ? '종가 단일가 체결 모드 — 켰어요 (다음 주문부터)' : '장중 스텝 체결로 돌렸어요', 'gold')
    await refresh()
  }

  // 학생 화면 탭 노출 (0053) — 시작 전·진행 중 모두 가능
  const setFeature = async (patch) => {
    setBusy(true)
    const r = await actions.setStudentFeatures(patch)
    setBusy(false)
    if (!r.ok) {
      notify(errorText(r.error), 'down')
      return
    }
    const [k, v] = Object.entries(patch)[0]
    const label = k === 'enableOptions' ? '파생·헷지' : '예금'
    notify(v ? `학생 화면에 [${label}] 탭을 켰어요` : `[${label}] 탭을 숨겼어요`, 'gold')
    await refresh()
  }

  // 거래 타이머 일시정지 / 재개 (0049)
  const togglePause = async () => {
    setBusy(true)
    const r = paused ? await actions.resumeTimer() : await actions.pauseTimer()
    setBusy(false)
    if (!r.ok) {
      notify(errorText(r.error), 'down')
      return
    }
    notify(paused ? '거래를 재개했어요' : '거래를 일시정지했어요', 'gold')
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

  // 콘솔 히어로의 "다음 할 일" — 상태 기반으로 지금 눌러야 할 버튼 딱 하나.
  const timerState = paused ? 'paused' : timerRunning ? 'live' : endsAt ? 'closed' : 'waiting'
  let consoleAction
  if (!endsAt) {
    consoleAction = {
      label: `타이머 시작 (${durMin}분)`,
      msg: '타이머를 시작해야 매매가 열려요',
      run: startTimerNow,
      tone: 'prime',
    }
  } else if (timerRunning) {
    consoleAction = isLast
      ? { label: '대회 종료', msg: '마지막 라운드예요', run: () => setConfirm('end'), tone: 'danger' }
      : {
          label: '다음 연도로',
          msg: `거래 중이에요 (${mmss(remainingMs)} 남음) — 마감을 기다리거나 지금 넘길 수 있어요`,
          run: () => setConfirm('advance'),
          tone: 'ghost',
        }
  } else {
    consoleAction = isLast
      ? {
          label: '대회 종료',
          msg: '마지막 라운드예요. 종료하면 최종 정산됩니다',
          run: () => setConfirm('end'),
          tone: 'danger',
        }
      : {
          label: '다음 연도로 넘어가기',
          msg: '정산하면 순위가 갱신되고 힌트가 나갑니다',
          run: () => setConfirm('advance'),
          tone: 'prime',
        }
  }

  return (
    <div className="apanel console">
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

      {/* ── 콘솔 히어로: 라운드 · 타이머 · 다음 할 일을 한 블록에 ── */}
      {!notStarted && (
        <section className="acard console-hero">
          <div className="ch-zone ch-round">
            <span className="ch-lbl">현재 라운드</span>
            <b className="ch-round-val">
              ROUND {cur} · {game.round_year_map?.[String(cur)]}년
            </b>
            <span className="ch-round-meta">
              전체 {total}라운드 중 {cur}번째
            </span>
            <div className="src-row">
              <span className="src-label">시세 생성</span>
              <SourceBadge info={pathSources[Number(game.round_year_map?.[String(cur)])]} />
            </div>
          </div>

          <div className="ch-zone ch-timer">
            <span className="ch-lbl">거래 타이머</span>
            <TimerPill remainingMs={remainingMs} durationMs={durationMs} state={timerState} />
            <p className="anote">
              {paused
                ? '일시정지됨 — 학생 매매 잠금. [재개]하면 남은 시간이 그대로 이어져요'
                : timerRunning
                  ? '거래 진행 중 — 학생들이 매매할 수 있어요'
                  : endsAt
                    ? '거래 마감 — 순위 확인 후 다음 연도로 넘기세요'
                    : `타이머를 시작하면 ${durMin}분간 거래가 열려요`}
            </p>
            {timerRunning && (
              <div className="timer-adjust">
                <button className="act-btn adj" disabled={busy || paused} onClick={() => adjustTimer(-1)}>
                  − 1분
                </button>
                <span className="adj-hint">시간 조정</span>
                <button className="act-btn adj" disabled={busy || paused} onClick={() => adjustTimer(1)}>
                  + 1분
                </button>
              </div>
            )}
            <div className="ch-timer-btns">
              {timerRunning && (
                <button className="act-btn neutral" disabled={busy} onClick={togglePause}>
                  {paused ? '▶ 재개' : '⏸ 일시정지'}
                </button>
              )}
              {endsAt && (
                <button className="act-btn neutral" disabled={busy} onClick={startTimerNow}>
                  타이머 다시 시작 ({durMin}분)
                </button>
              )}
            </div>
          </div>

          <div className="ch-zone ch-action">
            <span className="ch-lbl">다음 할 일</span>
            <button
              className={
                'act-btn ch-action-btn' +
                (consoleAction.tone === 'prime'
                  ? ' prime'
                  : consoleAction.tone === 'danger'
                    ? ' danger'
                    : '')
              }
              disabled={busy}
              onClick={consoleAction.run}
            >
              {consoleAction.label}
            </button>
            <span className="ch-action-msg">{consoleAction.msg}</span>
          </div>
        </section>
      )}

      {/* 라운드 넘기기 상세 안내 — 넘기기 전에만 */}
      {!notStarted && !isLast && !timerRunning && (
        <p className="console-hint anote">
          [다음 연도로]를 누르면 <b>{nextYear}년 가격이 공개</b>되고 보유종목이 재평가돼{' '}
          <b>순위가 갱신</b>되며, 새 순위로 <b>힌트가 자동 배분</b>됩니다(하위권 우대). 되돌릴 수 없습니다.
        </p>
      )}

      {/* 참고: 라운드별 시세 생성 방식 (접기) */}
      {Object.keys(game.round_year_map ?? {}).length > 0 && (
        <details className="acard console-ref">
          <summary className="acap">라운드별 시세 생성 방식</summary>
          <p className="anote">
            📊 엑셀·브리지 = 연말가를 고정하고 그 사이를 브라운 브리지로 보간 · 🧮 수학엔진 = 7팩터/GARCH
            엔진이 경로와 연말가를 함께 산출. [주가 생성기] 탭에서 다시 만들 수 있어요.
          </p>
          <div className="src-grid">
            {Object.entries(game.round_year_map)
              .map(([r, y]) => [Number(r), Number(y)])
              .sort((a, b) => a[0] - b[0])
              .map(([r, y]) => (
                <div key={r} className="src-cell">
                  <span className="src-r">
                    R{r} · {y}
                  </span>
                  <SourceBadge info={pathSources[y]} />
                </div>
              ))}
          </div>
        </details>
      )}

      {/* ── 도구: 속보 발송 + 거래 현황 ── */}
      <div className="console-tools">
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

      {/* 학생 화면 탭 노출 — 안 가르친 기능을 학생 화면에서 치운다 */}
      <section className="acard">
        <span className="acap">학생 화면 탭</span>
        <p className="anote">
          안 가르친 기능은 숨기세요. 학생 화면에 <b>즉시</b> 반영되고, 수업 중에 가르친 뒤 켜도 돼요.
          숨겨도 이미 보유한 옵션·예금은 그대로 유지·정산됩니다.
        </p>
        <div className="feat-toggles">
          {[
            { key: 'enableOptions', on: game.enable_options !== false, label: '🛡️ 파생·헷지', desc: '옵션 매수·헷지' },
            { key: 'enableSavings', on: game.enable_savings !== false, label: '🏦 예금', desc: '기준금리 연동 예금' },
          ].map((f) => (
            <div key={f.key} className={'feat-row' + (f.on ? ' on' : '')}>
              <div className="feat-info">
                <span className="feat-name">{f.label}</span>
                <span className="feat-desc">{f.desc}</span>
              </div>
              <div className="tabs mini">
                <button
                  className={f.on ? 'on' : ''}
                  disabled={busy}
                  onClick={() => setFeature({ [f.key]: true })}
                >
                  보임
                </button>
                <button
                  className={!f.on ? 'on' : ''}
                  disabled={busy}
                  onClick={() => setFeature({ [f.key]: false })}
                >
                  숨김
                </button>
              </div>
            </div>
          ))}
        </div>
        {game.enable_options === false && game.enable_savings === false && (
          <p className="anote">둘 다 숨겨서 학생은 주식 매매 화면만 봐요 (탭 바가 사라집니다).</p>
        )}
      </section>

      {/* 체결 방식 — 진행 중에도 토글 (초보용: 차트 단타 잠금) */}
      {!notStarted && (
        <section className="acard">
          <span className="acap">체결 방식</span>
          <div className="tabs mini">
            <button
              className={!game.flat_pricing ? 'on' : ''}
              disabled={busy}
              onClick={() => setFlat(false)}
            >
              장중 스텝 (실시간 시세로 체결)
            </button>
            <button
              className={game.flat_pricing ? 'on' : ''}
              disabled={busy}
              onClick={() => setFlat(true)}
            >
              틱 거래 잠금 (그 해 종가 단일가 · 초보용)
            </button>
          </div>
          <p className="anote">
            {game.flat_pricing
              ? '지금은 장중 어느 시점에 주문해도 그 해 종가로 체결돼요. 차트·애니메이션은 그대로.'
              : '지금은 장중 스텝값으로 체결돼요. 학생이 차트 단타를 하면 [틱 거래 잠금]으로 바꾸세요 — 다음 주문부터 적용.'}
          </p>
        </section>
      )}

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
      </div>

      {/* 게임 설정 · 데이터 점검 · 게임 리셋 → [시스템] 탭으로 이동 (AdminSystem.jsx) */}

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
    </div>
  )
}
