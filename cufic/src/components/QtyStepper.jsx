import { useLayoutEffect, useRef, useState } from 'react'
import { num } from '../format'

/**
 * 주문 수량 입력. −/+ 버튼과 직접 입력을 함께 지원한다.
 *
 * 입력 중에는 draft(원문 문자열)를 그대로 보여주고, 확정(blur·Enter) 시점에
 * 0~max로 자른다. 타이핑 도중에 자르면 "100"을 치는 중에 "82"로 튀어서
 * 무엇이 입력됐는지 알 수 없게 된다.
 *
 * @param {number} value
 * @param {(n: number) => void} onChange
 * @param {number} max      주문가능 수량(매수) 또는 보유 수량(매도)
 * @param {string} label    필드 아래 표시될 이름 ("매수 수량" 등)
 * @param {string} maxLabel 100% 버튼 이름 ("최대" 또는 "전량")
 */
export default function QtyStepper({ value, onChange, max, label, maxLabel = '최대', disabled = false }) {
  const inputRef = useRef(null)
  const [draft, setDraft] = useState(null) // null이면 비편집 상태

  // 포커스 시 전체 선택. setDraft로 값이 바뀐 뒤(=렌더 후)에 선택해야 하는데,
  // rAF로 미루면 사용자가 이미 친 글자를 선택해버려 다음 글자가 덮어쓴다.
  // 렌더 직후 동기로 실행되는 layout effect에서 처리한다.
  const selectNext = useRef(false)
  useLayoutEffect(() => {
    if (!selectNext.current) return
    selectNext.current = false
    inputRef.current?.select()
  })

  // Esc 취소. setDraft(null)은 비동기라 뒤이은 blur의 commit이 옛 draft를
  // 확정해버린다 — ref로 즉시 표시해서 commit을 건너뛴다.
  const cancelled = useRef(false)

  const clamp = (n) => Math.max(0, Math.min(max, n))

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false
      setDraft(null)
      return
    }
    if (draft === null) return
    const n = parseInt(draft, 10)
    onChange(Number.isNaN(n) ? 0 : clamp(n))
    setDraft(null)
  }

  const step = (delta) => {
    cancelled.current = true // 진행 중이던 입력은 버리고 버튼 값을 따른다
    setDraft(null)
    onChange(clamp(value + delta))
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      cancelled.current = true
      setDraft(null)
      e.currentTarget.blur()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      step(1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      step(-1)
    }
  }

  return (
    <div className={'stepper' + (disabled ? ' locked' : '')}>
      <button onClick={() => step(-1)} disabled={disabled || value <= 0} aria-label={`${label} 1 감소`}>
        −
      </button>

      <div className="qty">
        <input
          ref={inputRef}
          className="num"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          // 편집 중엔 원문, 아니면 천단위 구분자를 넣어 보여준다
          value={draft ?? num(value)}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 7))}
          onFocus={() => {
            selectNext.current = true
            setDraft(String(value))
          }}
          onBlur={commit}
          onKeyDown={onKeyDown}
          aria-label={label}
        />
        <span>{label}</span>
      </div>

      <button onClick={() => step(1)} disabled={disabled || value >= max} aria-label={`${label} 1 증가`}>
        +
      </button>
    </div>
  )
}

// 비율 버튼. 시드가 1억이면 최대 1,000주가 넘어서 −/+로는 감당이 안 된다.
const RATIOS = [0.1, 0.25, 0.5, 1]

export function QtyRatios({ max, onPick, maxLabel = '최대', disabled = false, onBlocked }) {
  const blocked = max <= 0 // 잠금은 아니지만 살/팔 수량이 0 (예수금 부족 등)
  return (
    <div className={'ratios' + (disabled ? ' locked' : '')}>
      {RATIOS.map((r) => (
        <button
          key={r}
          onClick={() => (blocked ? onBlocked?.() : onPick(r === 1 ? max : Math.floor(max * r)))}
          disabled={disabled}
        >
          {r === 1 ? maxLabel : `${r * 100}%`}
        </button>
      ))}
    </div>
  )
}
