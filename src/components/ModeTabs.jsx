// 주식 매매(Spot) ↔ 파생·헷지 ↔ 예금 전환. 순수 UI 상태만 — 서버 데이터는 안 건드린다.
//
// 어떤 탭을 보여줄지는 강사가 정한다(game_state.enable_options / enable_savings, 마이그레이션 0053).
// 안 가르친 기능이 학생 화면에 상시 노출되면 교육 사고로 이어진다 — 초보 대상 반은 1탭으로 쓴다.
// 탭이 하나뿐이면 탭 바 자체를 그리지 않는다(고를 게 없는데 탭이 있으면 군더더기다).
export default function ModeTabs({ mode, onChange, showOptions = true, showSavings = true }) {
  const tabs = [
    { key: 'spot', label: '📈 주식 매매', on: true },
    { key: 'hedge', label: '🛡️ 파생·헷지', on: showOptions },
    { key: 'savings', label: '🏦 예금', on: showSavings },
  ].filter((t) => t.on)

  if (tabs.length < 2) return null

  return (
    <div className="mode-tabs">
      {tabs.map((t) => (
        <button
          key={t.key}
          className={'mode-tab' + (mode === t.key ? ' on' : '')}
          onClick={() => onChange(t.key)}
          aria-pressed={mode === t.key}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
