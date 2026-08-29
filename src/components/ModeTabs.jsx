// 주식 매매(Spot) ↔ 파생·헷지(Derivatives) 전환. 순수 UI 상태만 — 서버 데이터는 안 건드린다.
export default function ModeTabs({ mode, onChange }) {
  return (
    <div className="mode-tabs">
      <button
        className={'mode-tab' + (mode === 'spot' ? ' on' : '')}
        onClick={() => onChange('spot')}
        aria-pressed={mode === 'spot'}
      >
        📈 주식 매매
      </button>
      <button
        className={'mode-tab' + (mode === 'hedge' ? ' on' : '')}
        onClick={() => onChange('hedge')}
        aria-pressed={mode === 'hedge'}
      >
        🛡️ 파생·헷지
      </button>
    </div>
  )
}
