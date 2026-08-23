/** 다크/라이트 테마 토글 버튼 (해·달 아이콘) */
export default function ThemeToggle({ theme, onToggle, className = '' }) {
  const dark = theme === 'dark'
  return (
    <button
      className={'icon-btn ' + className}
      onClick={onToggle}
      title={dark ? '라이트 모드로 전환' : '다크 모드로 전환'}
      aria-label={dark ? '라이트 모드로 전환' : '다크 모드로 전환'}
    >
      {dark ? (
        // 달
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        // 해
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  )
}
