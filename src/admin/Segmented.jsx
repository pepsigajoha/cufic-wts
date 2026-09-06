// 토스풍 세그먼트 컨트롤 — 관리자 화면 공통. 큰 탭 영역, 선택 시 카드처럼 떠오름.
// options: [{ id, label }], value: 선택 id(없으면 null → 아무것도 안 켜짐), onChange(id)
export default function Segmented({ options, value, onChange, ariaLabel, size = 'md' }) {
  return (
    <div className={'seg seg-' + size} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className={'seg-opt' + (value === o.id ? ' on' : '')}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
