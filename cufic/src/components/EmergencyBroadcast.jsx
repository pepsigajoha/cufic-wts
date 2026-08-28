import { useEffect, useRef } from 'react'

/**
 * 긴급 속보 팝업 — 새 공통 속보가 오면 재난문자처럼 화면 전체에 먼저 띄운다.
 * 확인을 누르면 닫히고, 내용은 헤더의 종(속보 목록)에 남는다.
 */
export default function EmergencyBroadcast({ broadcast, onClose }) {
  const okRef = useRef(null)

  useEffect(() => {
    if (!broadcast) return
    okRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [broadcast, onClose])

  if (!broadcast) return null

  return (
    <div className="dim alert-dim" onClick={onClose}>
      <div
        className="alert-card"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-label="긴급 속보"
      >
        <div className="alert-head">
          <span className="alert-icon" aria-hidden="true">
            📢
          </span>
          긴급 속보
        </div>
        <p className="alert-body">{broadcast.headline}</p>
        <button ref={okRef} className="alert-ok" onClick={onClose}>
          확인
        </button>
      </div>
    </div>
  )
}
