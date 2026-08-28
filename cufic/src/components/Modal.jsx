import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * 공통 모달. 딤 클릭 · 우상단 X · ESC로 닫힌다.
 * Tab은 모달 안에서만 순환하고, 닫히면 열기 전에 있던 곳으로 포커스가 돌아간다.
 *
 * @param {boolean} open
 * @param {() => void} onClose
 * @param {string} title
 * @param {boolean} [wide]  넓은 모달(재무제표·MY)
 */
export default function Modal({ open, onClose, title, wide, children }) {
  const boxRef = useRef(null)
  // onClose는 부모에서 매 렌더 새 함수로 온다. 이펙트 의존성에 넣으면 타이머 등으로
  // 부모가 리렌더될 때마다 이펙트가 재실행돼 first.focus()가 모달을 맨 위로 스크롤시킨다.
  // → 의존성은 [open]만, 최신 onClose는 ref로 참조한다.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return

    // 열기 전 포커스를 기억해 뒀다가 닫을 때 돌려준다
    const restoreTo = document.activeElement

    const items = () => [...(boxRef.current?.querySelectorAll(FOCUSABLE) ?? [])]

    // 모달 안에 포커스를 넣어야 Tab이 여기서부터 돈다 (열릴 때 한 번만)
    const first = items()[0]
    if (first && !boxRef.current.contains(document.activeElement)) first.focus()

    const onKey = (e) => {
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return

      const list = items()
      if (!list.length) {
        e.preventDefault()
        return
      }
      const firstEl = list[0]
      const lastEl = list[list.length - 1]
      const active = document.activeElement

      // 양 끝에서 넘어가려 하면 반대편으로 되돌려 모달 밖으로 못 나가게 한다
      if (e.shiftKey && (active === firstEl || !boxRef.current.contains(active))) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    window.addEventListener('keydown', onKey)
    // 모달 열린 동안 뒷 화면 스크롤 잠금
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      restoreTo?.focus?.()
    }
  }, [open])

  if (!open) return null

  return (
    <div className="dim" onClick={onClose}>
      <div
        ref={boxRef}
        className={'modal' + (wide ? ' wide' : '')}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mhead">
          <h2>{title}</h2>
          <button className="mx" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="mbody">{children}</div>
      </div>
    </div>
  )
}
