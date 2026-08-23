import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import QtyStepper from './QtyStepper'

afterEach(cleanup)

/** 실제 화면처럼 부모가 값을 들고 있는 상태로 렌더한다 */
function Harness({ max = 100, initial = 0 }) {
  const [qty, setQty] = useState(initial)
  return (
    <>
      <QtyStepper value={qty} onChange={setQty} max={max} label="매수 수량" />
      <output data-testid="qty">{qty}</output>
    </>
  )
}

const field = () => screen.getByLabelText('매수 수량')
const value = () => screen.getByTestId('qty').textContent

describe('직접 입력', () => {
  it('숫자를 치고 Enter로 확정한다', async () => {
    const u = userEvent.setup()
    render(<Harness />)
    await u.click(field())
    await u.keyboard('25{Enter}')
    expect(value()).toBe('25')
  })

  it('한도를 넘으면 잘린다', async () => {
    const u = userEvent.setup()
    render(<Harness max={82} />)
    await u.click(field())
    await u.keyboard('9999{Enter}')
    expect(value()).toBe('82')
  })

  it('숫자가 아닌 글자는 무시한다', async () => {
    const u = userEvent.setup()
    render(<Harness />)
    await u.click(field())
    await u.keyboard('a7b{Enter}')
    expect(value()).toBe('7')
  })

  // 버그: 포커스 시 requestAnimationFrame으로 예약한 select()가 타이핑 도중에 실행돼
  // 텍스트를 전체 선택해버렸다. 실제 브라우저에선 "100"을 치면 1 → (전체선택) → 0이
  // 덮어씀 → 최종 0이 됐다. layout effect로 옮겨(렌더 직후 동기 실행) 고쳤다.
  //
  // 아래 세 테스트가 이 버그를 막는다. rAF를 되살리면 '비우고 확정' 테스트가
  // '1' != '0'으로 실패한다 — select가 Backspace보다 늦게 걸려 한 글자만 지워지기 때문.
  // (jsdom은 실제 브라우저와 타이밍이 달라 "100"→"0" 경로를 그대로 재현하진 못하지만,
  //  select 타이밍이 어긋나는 순간 이 셋 중 하나는 반드시 깨진다.)
  it('[회귀] 비우고 확정하면 0이 된다 — 포커스 시 전체 선택이 제때 걸려야 한다', async () => {
    const u = userEvent.setup()
    render(<Harness initial={10} />)
    await u.click(field())
    await u.keyboard('{Backspace}{Enter}')
    expect(value()).toBe('0')
  })

  it('[회귀] 여러 글자를 연달아 쳐도 앞 글자가 덮어써지지 않는다', async () => {
    const u = userEvent.setup()
    render(<Harness max={1000} />)
    await u.click(field())
    await u.keyboard('100{Enter}')
    expect(value()).toBe('100')
  })

  it('[회귀] 포커스 시 기존 값이 전체 선택돼 바로 덮어쓸 수 있다', async () => {
    const u = userEvent.setup()
    render(<Harness initial={45} />)
    await u.click(field())
    await u.keyboard('7{Enter}') // 45가 선택된 상태라 7로 대체돼야 한다
    expect(value()).toBe('7')
  })
})

describe('Esc 취소', () => {
  // 버그: setDraft(null)은 비동기인데 blur()는 동기라, onBlur의 commit이 아직 남아
  // 있던 옛 draft를 그대로 확정했다. Esc를 눌러도 입력값이 들어갔다.
  it('[회귀] Esc를 누르면 편집 전 값으로 되돌아간다', async () => {
    const u = userEvent.setup()
    render(<Harness initial={33} />)
    await u.click(field())
    await u.keyboard('55{Escape}')
    expect(value()).toBe('33')
  })

  it('[회귀] Esc로 취소한 뒤 다시 입력하면 정상 확정된다', async () => {
    const u = userEvent.setup()
    render(<Harness initial={33} />)
    await u.click(field())
    await u.keyboard('55{Escape}')
    await u.click(field())
    await u.keyboard('12{Enter}')
    expect(value()).toBe('12')
  })
})

describe('버튼과 방향키', () => {
  it('+ / − 로 1씩 움직인다', async () => {
    const u = userEvent.setup()
    render(<Harness initial={5} />)
    await u.click(screen.getByLabelText('매수 수량 1 증가'))
    expect(value()).toBe('6')
    await u.click(screen.getByLabelText('매수 수량 1 감소'))
    expect(value()).toBe('5')
  })

  it('↑ ↓ 로도 1씩 움직인다', async () => {
    const u = userEvent.setup()
    render(<Harness initial={5} />)
    await u.click(field())
    await u.keyboard('{ArrowUp}{ArrowUp}')
    expect(value()).toBe('7')
    await u.keyboard('{ArrowDown}')
    expect(value()).toBe('6')
  })

  it('한도에 닿으면 + 가 비활성화된다', async () => {
    render(<Harness max={5} initial={5} />)
    expect(screen.getByLabelText('매수 수량 1 증가')).toBeDisabled()
  })

  it('0에서는 − 가 비활성화된다', () => {
    render(<Harness initial={0} />)
    expect(screen.getByLabelText('매수 수량 1 감소')).toBeDisabled()
  })

  it('한도가 0이면(거래정지·보유없음) 양쪽 다 비활성화된다', () => {
    render(<Harness max={0} initial={0} />)
    expect(screen.getByLabelText('매수 수량 1 증가')).toBeDisabled()
    expect(screen.getByLabelText('매수 수량 1 감소')).toBeDisabled()
  })
})

describe('표시', () => {
  it('편집 중이 아니면 천단위 구분자를 넣는다', () => {
    render(<Harness initial={1808} max={2000} />)
    expect(field()).toHaveValue('1,808')
  })

  it('편집에 들어가면 구분자 없는 원문이 된다', async () => {
    const u = userEvent.setup()
    render(<Harness initial={1808} max={2000} />)
    await u.click(field())
    expect(field()).toHaveValue('1808')
  })
})
