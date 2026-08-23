import { useState } from 'react'
import ThemeToggle from './ThemeToggle'

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
export default function Login({ mode = 'code', onSubmit, onJoin, onCommit, theme, onToggleTheme }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const open = mode === 'open'

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
    <div className="login">
      <ThemeToggle theme={theme} onToggle={onToggleTheme} className="theme-fab" />

      <div className="card">
        <span className="brand-logo" role="img" aria-label="CUFIC WTS" />
        <h1>CUFIC WTS</h1>
        <p className="sub2">스마트 주식 교실 · 모의투자 시스템</p>

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
                  autoFocus
                  autoComplete="off"
                  spellCheck="false"
                />
              </div>
              <div className="err">{error}</div>
              <button type="submit" className="go" disabled={busy}>
                {busy ? '확인 중…' : '입장하기'}
              </button>
            </form>
            <p className="hint">참가 코드는 강사 선생님에게 받으세요</p>
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
                  autoFocus
                  autoComplete="off"
                  spellCheck="false"
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
                />
              </div>
              <div className="err">{error}</div>
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
      </div>
    </div>
  )
}
