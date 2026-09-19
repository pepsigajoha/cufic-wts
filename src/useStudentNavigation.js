import { useEffect, useRef, useState } from 'react'

const KEY = 'cuficStudentNavigation'
const VIEWS = ['stocks', 'analysis', 'order']
const MODES = ['spot', 'hedge', 'savings']
const isMobile = () => window.matchMedia?.('(max-width: 1023px)').matches === true
const page = () => window.location.pathname + window.location.search
const readRoute = (state) => {
  const route = state?.[KEY]
  return route?.page === page() && VIEWS.includes(route.view) && MODES.includes(route.mode) ? route : null
}
const writeRoute = (method, view, mode) => window.history[method](
  { ...window.history.state, [KEY]: { page: page(), view, mode } }, '',
)

/** 휴대폰의 시스템 뒤로가기와 화면의 복귀 버튼이 같은 경로를 사용한다. */
export function useStudentNavigation() {
  const [view, setView] = useState(() => isMobile() ? readRoute(window.history.state)?.view ?? 'stocks' : 'stocks')
  const [mode, setMode] = useState(() => isMobile() ? readRoute(window.history.state)?.mode ?? 'spot' : 'spot')
  const fromHistory = useRef(false)
  const pendingMode = useRef(null)

  useEffect(() => {
    const onPop = (event) => {
      if (!isMobile()) return
      const route = readRoute(event.state)
      if (!route) return
      if (pendingMode.current) {
        const next = pendingMode.current
        pendingMode.current = null
        for (let i = 1; i <= VIEWS.indexOf(next.view); i++) writeRoute('pushState', VIEWS[i], next.mode)
        return
      }
      fromHistory.current = true
      setView(route.view)
      setMode(route.mode)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (!isMobile()) return
    if (fromHistory.current) {
      fromHistory.current = false
      return
    }
    if (pendingMode.current) {
      pendingMode.current = { view, mode }
      return
    }
    let current = readRoute(window.history.state)
    if (!current) {
      writeRoute('replaceState', 'stocks', 'spot')
      current = readRoute(window.history.state)
    }
    const depth = VIEWS.indexOf(view)
    const previousDepth = VIEWS.indexOf(current.view)
    // 복귀 버튼도 기존 방문 기록으로 이동한다. 목록을 새 기록으로 추가하지 않는다.
    if (depth < previousDepth) {
      if (mode !== current.mode) {
        pendingMode.current = { view, mode }
        window.history.go(-previousDepth)
        return
      }
      window.history.go(depth - previousDepth)
      return
    }
    for (let i = previousDepth + 1; i <= depth; i++) writeRoute('pushState', VIEWS[i], mode)
    writeRoute('replaceState', view, mode)
  }, [view, mode])

  return { view, setView, mode, setMode }
}
