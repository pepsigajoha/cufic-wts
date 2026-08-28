// 테마(다크/라이트) 관리. <html data-theme="..."> 속성으로 전환한다.
import { useCallback, useEffect, useState } from 'react'

const THEME_KEY = 'wts-theme'

function loadTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    return saved === 'light' || saved === 'dark' ? saved : 'dark'
  } catch {
    return 'dark'
  }
}

export function useTheme() {
  const [theme, setTheme] = useState(loadTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // 시크릿 모드 등에서 저장 실패 - 무시하고 세션 내에서만 유지
    }
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  return [theme, toggle]
}
