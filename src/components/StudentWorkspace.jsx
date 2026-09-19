const ICONS = {
  stocks: <><path d="M4 5h16M4 12h16M4 19h16" /><circle cx="7" cy="5" r="1" /><circle cx="7" cy="12" r="1" /><circle cx="7" cy="19" r="1" /></>,
  analysis: <><path d="M4 3v17h17M7 15l4-5 4 3 5-7" /></>,
  order: <><path d="M7 3h10v18H7zM10 7h4M10 11h4M10 15h4" /></>,
  account: <><path d="M3 6h18v14H3zM3 6V4h15v2M16 11h5v5h-5z" /></>,
}

/** 같은 패널을 유지해 모바일 화면 전환으로 주문 수량·차트 메모가 사라지지 않게 한다. */
export default function StudentWorkspace({ view, onViewChange, mode, stock, onOpenMy, onOrderSide, tradingOpen, children }) {
  const savings = mode === 'savings'
  const activeView = savings && view === 'stocks' ? 'order' : view
  const tabs = [
    ...(!savings ? [{ key: 'stocks', label: '종목' }] : []),
    { key: 'analysis', label: savings ? '금리·안내' : mode === 'hedge' ? '손익·헷지' : '차트·근거' },
    ...(mode !== 'spot' ? [{ key: 'order', label: savings ? '가입·내 예금' : '주문' }] : []),
  ]
  const detail = mode === 'spot' && activeView === 'analysis'

  return (
    <>
      {!savings && activeView !== 'stocks' && (
        <div className="mobile-context">
          <button type="button" className="mobile-back" onClick={() => onViewChange(activeView === 'order' ? 'analysis' : 'stocks')} aria-label={activeView === 'order' ? '종목 상세로 돌아가기' : '종목 목록으로 돌아가기'}>
            <span aria-hidden="true">‹</span><span>{activeView === 'order' ? '종목 상세로' : '종목 목록'}</span>
          </button>
          <strong>{stock.name}</strong>
          {activeView === 'order' && <button type="button" className="mobile-list-return" onClick={() => onViewChange('stocks')}>종목 목록</button>}
        </div>
      )}
      <div className={`app mobile-view-${activeView}`}>{children}</div>
      {detail && <div className="mobile-order-actions" aria-label="종목 거래">
        <button type="button" className="mobile-assets" onClick={onOpenMy} aria-haspopup="dialog">내 자산</button>
        <button type="button" className="mobile-sell" disabled={!tradingOpen || stock.halted} onClick={() => { onOrderSide?.('sell'); onViewChange('order') }}>매도하기</button>
        <button type="button" className="mobile-buy" disabled={!tradingOpen || stock.halted} onClick={() => { onOrderSide?.('buy'); onViewChange('order') }}>매수하기</button>
      </div>}
      <nav className={`student-mobile-nav${detail ? ' mobile-nav-detail' : ''}`} aria-label="학생 화면">
        {tabs.map((t) => (
          <button key={t.key} type="button" aria-current={activeView === t.key ? 'page' : undefined} onClick={() => onViewChange(t.key)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[t.key]}</svg><span>{t.label}</span>
          </button>
        ))}
        <button type="button" onClick={onOpenMy} aria-haspopup="dialog">
          <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS.account}</svg><span>내 자산</span>
        </button>
      </nav>
    </>
  )
}
