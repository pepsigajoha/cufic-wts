import { useCallback, useEffect, useRef, useState } from 'react'

const DURATION = 2600

/**
 * 토스트 알림.
 * const [toasts, pushToast] = useToasts()
 * pushToast('매수 주문이 체결되었습니다', 'up')
 * pushToast('새 뉴스', 'gold', () => focusNews(id))  // 누르면 실행 후 닫힘
 */
export function useToasts() {
  const [toasts, setToasts] = useState([])
  const seq = useRef(0)
  const timers = useRef([])

  const push = useCallback((message, tone = 'gold', onClick = null) => {
    const id = ++seq.current
    setToasts((list) => [...list, { id, message, tone, onClick }])
    const t = setTimeout(() => {
      setToasts((list) => list.filter((x) => x.id !== id))
    }, DURATION)
    timers.current.push(t)
  }, [])

  const dismiss = useCallback((id) => setToasts((list) => list.filter((x) => x.id !== id)), [])

  // 언마운트 시 예약된 타이머 정리
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  return [toasts, push, dismiss]
}

export default function Toasts({ toasts, onDismiss }) {
  if (!toasts.length) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) =>
        t.onClick ? (
          // 누를 수 있는 토스트는 버튼이어야 키보드로도 닿는다
          <button
            key={t.id}
            className={'toast tappable ' + t.tone}
            onClick={() => {
              t.onClick()
              onDismiss?.(t.id)
            }}
          >
            {t.message}
            <span className="go">보러가기 →</span>
          </button>
        ) : (
          <div key={t.id} className={'toast ' + t.tone}>
            {t.message}
          </div>
        ),
      )}
    </div>
  )
}
