import { useState } from 'react'
import Modal from '../components/Modal'
import { errorText } from '../supabase'
import { checkContent } from '../dataCheck'
import { num } from '../format'

/**
 * 시스템 / DB 관리 탭. 대회를 "돌리는" 조작(진행 탭)과 분리해, 게임을 "설정·점검·초기화"하는
 * 되돌리기 어려운 작업만 모아 둔다. 파괴적 작업(리셋)은 RESET 타이핑까지 요구한다.
 *
 * 진행 탭에 흩어져 있던 3가지를 여기로 옮겼다: 게임 설정 · 데이터 점검 · 게임 리셋.
 */
export default function AdminSystem({
  actions,
  game,
  stocks = [],
  hints = [],
  financials = [],
  macro = [],
  refresh,
  notify,
}) {
  const [cfg, setCfg] = useState(null)
  const [issues, setIssues] = useState(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetText, setResetText] = useState('')
  const [busy, setBusy] = useState(false)

  if (!game) return null
  const notStarted = game.current_round === 0

  // ── 게임 설정 (시작 전에만)
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
      flatPricing: game.flat_pricing ?? false,
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
    // 빈 칸이 그대로 저장되면 서버·시드에 NaN이 들어간다 — 보내기 전에 막는다.
    const roundYearMap = {}
    for (let r = 1; r <= cfg.totalRounds; r++) roundYearMap[r] = Number(cfg.years[r])
    const nums = {
      finalYear: Number(cfg.finalYear),
      defaultSeed: Number(cfg.defaultSeed),
      durationMinutes: Number(cfg.durationMinutes),
    }
    const bad =
      Object.values(roundYearMap).some((y) => !Number.isFinite(y)) ||
      Object.values(nums).some((n) => !Number.isFinite(n)) ||
      nums.defaultSeed <= 0 ||
      nums.durationMinutes <= 0
    if (bad) return notify('숫자 칸을 모두 올바르게 채워 주세요', 'down')

    setBusy(true)
    const res = await actions.updateGameConfig({
      totalRounds: cfg.totalRounds,
      roundYearMap,
      ...nums,
      joinMode: cfg.joinMode,
      flatPricing: cfg.flatPricing,
    })
    setBusy(false)
    if (!res.ok) return notify(errorText(res.error), 'down')
    setCfg(null)
    notify('게임 설정을 저장했어요', 'gold')
    await refresh()
  }

  const runCheck = () => {
    try {
      setIssues(checkContent(game, stocks, hints, financials, macro) ?? [])
    } catch (e) {
      console.error('[admin:checkContent]', e)
      notify('데이터 점검 중 오류가 났어요 — 데이터 형식을 확인해 주세요', 'down')
    }
  }

  const doReset = async () => {
    setBusy(true)
    const r = await actions.resetGame()
    setBusy(false)
    setConfirmReset(false)
    setResetText('')
    if (!r.ok) return notify(errorText(r.error), 'down')
    notify('게임이 초기화되었습니다', 'gold')
    await refresh()
  }

  return (
    <div className="apanel">
      {/* 게임 설정 */}
      <section className="acard">
        <span className="acap">게임 설정 {notStarted ? '' : '(시작 후에는 잠김)'}</span>
        {!notStarted ? (
          <p className="anote">
            대회가 이미 시작됐어요. 라운드 수·연도·시드·타이머·입장 방식은 리셋 전에는 바꿀 수 없어요.
          </p>
        ) : !cfg ? (
          <>
            <p className="anote">
              라운드 {game.total_rounds}개 · 연도 {Object.values(game.round_year_map ?? {}).join('·')} ·
              최종 {game.final_year} · 기본 시드 ₩{num(game.default_seed)} · 타이머{' '}
              {Math.round((game.round_duration_seconds ?? 600) / 60)}분 · 입장{' '}
              {game.join_mode === 'open' ? '자율(닉네임)' : '코드'} · 체결{' '}
              {game.flat_pricing ? '종가 단일가(초보용)' : '장중 스텝'}
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
            <div className="frow col">
              <label>체결 방식</label>
              <div className="tabs mini">
                <button
                  className={!cfg.flatPricing ? 'on' : ''}
                  onClick={() => setCfg({ ...cfg, flatPricing: false })}
                >
                  장중 스텝 (실시간 시세로 체결)
                </button>
                <button
                  className={cfg.flatPricing ? 'on' : ''}
                  onClick={() => setCfg({ ...cfg, flatPricing: true })}
                >
                  틱 거래 잠금 (그 해 종가 단일가 · 초보용)
                </button>
              </div>
              <span className="anote">
                틱 거래 잠금: 차트·장중 애니메이션·일/월/년 조회는 그대로 두고, <b>체결만 그 해
                종가 단일가</b>로 묶어요. 장중 어느 시점에 주문해도 같은 값에 체결돼 차트 단타가
                무의미해집니다.
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

      {/* 게임 리셋 — 파괴적, 이중 확인 */}
      <section className="acard danger reset-card">
        <span className="acap">게임 리셋 (되돌릴 수 없음)</span>
        <p className="anote">
          모든 조의 예수금이 초기 자본으로 돌아가고 보유·체결내역·힌트 지급·옵션·예금이 전부 사라집니다.
          종목·힌트 등 콘텐츠는 남습니다.
        </p>
        <button className="act-btn danger" disabled={busy} onClick={() => setConfirmReset(true)}>
          게임 리셋
        </button>
      </section>

      {/* 리셋 — RESET 타이핑 확인 */}
      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="게임 리셋">
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
          <button className="cancel" onClick={() => setConfirmReset(false)}>
            취소
          </button>
          <button
            className="act-btn danger"
            disabled={busy || resetText !== 'RESET'}
            onClick={doReset}
          >
            {busy ? '초기화 중…' : '초기화'}
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
