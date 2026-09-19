import { useState } from 'react'
import ThemeToggle from './ThemeToggle'
import QuickJoinQr from './QuickJoinQr'

/**
 * 입장 화면. 두 방식 —
 *   · code(기본): 강사가 나눠준 참가 코드 입력 (`onSubmit`).
 *   · open(자율): 닉네임 + 공용 게임 PIN으로 조를 만들거나 재접속 (`onJoin`/`onCommit`).
 *     PIN은 강사가 발급해 전달하는 "게임 하나에 공용 PIN 하나". 신규·재접속 모두 같은 PIN.
 *
 * @param {'code'|'open'} mode
 * @param {(code:string)=>Promise<{ok,error?}>} onSubmit  코드 방식 로그인(입장까지 처리)
 * @param {(name:string, pin?:string)=>Promise<{ok, team?, created?, code?, error?}>} onJoin  자율 입장 시도(입장 확정 안 함)
 * @param {(team)=>Promise<void>} onCommit  실제 입장 확정
 */
export default function Login({ mode = 'code', onSubmit, onJoin, onCommit, notice = '', quickJoinEnabled = false, theme, onToggleTheme }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const open = mode === 'open'
  const quickJoinUrl = typeof window === 'undefined' ? '' : `${window.location.origin}/?join=quick`

  const submitCode = async (e) => {
    e.preventDefault()
    setBusy(true)
    const r = await onSubmit(code)
    setBusy(false)
    if (!r.ok) setError(r.error)
  }

  const submitJoin = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    const r = await onJoin(name, pin)
    setBusy(false)
    if (r.ok) await onCommit(r.team)
    else setError(r.error)
  }

  return (
    <div className="login student-login">
      <ThemeToggle theme={theme} onToggle={onToggleTheme} className="theme-fab" />

      <main className="student-login-shell">
        <section className="student-login-hero" aria-labelledby="student-login-title">
          <div className="student-brand">
            <span className="brand-logo" role="img" aria-label="CUFIC WTS" />
            <span>
              <b>CUFIC WTS</b>
              <small>청소년 모의투자</small>
            </span>
          </div>
          <div className="student-login-copy">
            <p>교실에서 만나는 주식시장</p>
            <h1 id="student-login-title">시장 흐름을 읽고<br />우리 조의 전략을 세워보세요.</h1>
            <span>뉴스와 재무정보를 살피고, 라운드마다 투자 전략을 세워보세요.</span>
          </div>
          <ol className="login-route" aria-label="게임 진행 순서">
            <li>뉴스 읽기</li>
            <li>기업 비교</li>
            <li>우리 조 투자</li>
          </ol>
        </section>

        <section className="student-login-card" aria-label="학생 입장">
          <span className="student-login-badge">학생 입장</span>
          <h2>{quickJoinEnabled ? 'QR로 바로 입장하세요' : open ? '조 이름과 PIN을 입력하세요' : '참가 코드를 입력하세요'}</h2>
          <p className="student-login-guide">
            {quickJoinEnabled
              ? '스캔하면 랜덤 닉네임을 받고 게임에 바로 참여해요.'
              : open
                ? '선생님이 알려준 정보로 바로 시작할 수 있어요.'
                : '선생님에게 받은 조별 코드를 입력해 주세요.'}
          </p>
          {notice && <p className="quick-join-notice" role="status">{notice}</p>}
          {quickJoinEnabled && (
            <>
              <div className="student-quick-join">
                <QuickJoinQr className="student-quick-qr" url={quickJoinUrl} />
                <a className="student-quick-link" href="?join=quick">이 기기에서 바로 입장</a>
              </div>
              <div className="student-login-divider"><span>또는 직접 입력</span></div>
            </>
          )}

        {/* ── 코드 방식 ── */}
        {!open && (
          <>
            <form onSubmit={submitCode}>
              <div className="field">
                <label htmlFor="team-code">조별 참가 코드</label>
                <input
                  id="team-code"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value)
                    if (error) setError('')
                  }}
                  placeholder="TIGER-03"
                  autoFocus={!quickJoinEnabled}
                  autoComplete="off"
                  spellCheck="false"
                  enterKeyHint="go"
                />
              </div>
              <div className="err" role="alert" aria-live="polite">{error}</div>
              <button type="submit" className="go" disabled={busy}>
                {busy ? '확인 중…' : '입장하기'}
              </button>
            </form>
            <p className="hint">영문과 숫자, 하이픈까지 받은 그대로 입력해 주세요.</p>
          </>
        )}

        {/* ── 자율 입장: 닉네임 + 공용 게임 PIN (한 화면) ── */}
        {open && (
          <>
            <form onSubmit={submitJoin}>
              <div className="field">
                <label htmlFor="nick">닉네임 (우리 조 이름)</label>
                <input
                  id="nick"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (error) setError('')
                  }}
                  placeholder="예: 불꽃투자단"
                  maxLength={12}
                  autoFocus={!quickJoinEnabled}
                  autoComplete="off"
                  spellCheck="false"
                  enterKeyHint="next"
                />
              </div>
              <div className="field">
                <label htmlFor="pin">입장 PIN (4자리)</label>
                <input
                  id="pin"
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value.replace(/\D/g, '').slice(0, 4))
                    if (error) setError('')
                  }}
                  placeholder="0000"
                  inputMode="numeric"
                  autoComplete="off"
                  enterKeyHint="go"
                />
              </div>
              <div className="err" role="alert" aria-live="polite">{error}</div>
              <button
                type="submit"
                className="go"
                disabled={busy || name.trim().length < 2 || pin.length !== 4}
              >
                {busy ? '입장 중…' : '입장하기'}
              </button>
            </form>
            <p className="hint">
              강사 선생님이 알려준 <b>입장 PIN</b>을 넣으세요. 처음 닉네임이면 새 조가, 이미 있는 닉네임이면 그 조로 들어가요.
            </p>
          </>
        )}
          <a className="student-admin-link" href="?admin=1">강사용 관리자 화면</a>
        </section>
      </main>
    </div>
  )
}
