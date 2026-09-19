const TAB_GROUPS = [
  { label: '운영', tabs: [{ key: 'progress', label: '운영 콘솔' }, { key: 'board', label: '리더보드' }] },
  { label: '준비', tabs: [
    { key: 'datasets', label: '데이터셋' }, { key: 'stocks', label: '종목·가격' },
    { key: 'content', label: '재무·시황' }, { key: 'hints', label: '힌트' },
    { key: 'options', label: '파생·옵션' }, { key: 'simulator', label: '주가 생성기' }, { key: 'teams', label: '조 관리' },
  ] },
  { label: '검토·설정', tabs: [{ key: 'analytics', label: '통계' }, { key: 'system', label: '시스템' }] },
]

export default function AdminNavigation({ tab, onChange }) {
  return (
    <>
      <nav className="admin-tabs" aria-label="관리 화면">
        {TAB_GROUPS.map((g, i) => (
          <div key={g.label} className={'tab-group' + (i === 0 ? ' tab-group--primary' : '')}>
            {i > 0 && <span className="tab-group-label">{g.label}</span>}
            {g.tabs.map((t) => (
              <button key={t.key} type="button" className={tab === t.key ? 'on' : ''} aria-current={tab === t.key ? 'page' : undefined} onClick={() => onChange(t.key)}>{t.label}</button>
            ))}
          </div>
        ))}
      </nav>
      <nav className="admin-mobile-nav" aria-label="모바일 관리 화면">
        <button type="button" aria-current={tab === 'progress' ? 'page' : undefined} onClick={() => onChange('progress')}>운영</button>
        <button type="button" aria-current={tab === 'board' ? 'page' : undefined} onClick={() => onChange('board')}>순위</button>
        <select id="admin-page" value={tab} onChange={(e) => onChange(e.target.value)} aria-label="관리 화면 선택">
          {TAB_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.tabs.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </optgroup>
          ))}
        </select>
      </nav>
    </>
  )
}
