import { useEffect, useRef, useState } from 'react'

/**
 * 엘리먼트의 실제 픽셀 크기를 추적한다.
 * SVG viewBox를 실측값에 1:1로 맞춰야 글자·원이 늘어나지 않는다.
 * @returns {[React.RefObject, {w:number, h:number}]}
 */
export function useSize() {
  const ref = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ w: Math.round(width), h: Math.round(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return [ref, size]
}
