import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import ModeTabs from './ModeTabs'

afterEach(cleanup)

// 강사가 안 가르친 기능을 학생 화면에서 치우는 스위치(마이그레이션 0053).
// 여기가 틀리면 학생이 배운 적 없는 옵션을 사서 자산을 날린다 — 화면 문제가 아니라 교육 사고다.
const labels = (c) => [...c.querySelectorAll('.mode-tab')].map((b) => b.textContent)

describe('ModeTabs — 강사가 정한 탭만 보인다', () => {
  it('기본(둘 다 허용)이면 3탭이 다 보인다', () => {
    const { container } = render(<ModeTabs mode="spot" onChange={() => {}} />)
    expect(labels(container)).toHaveLength(3)
  })

  it('파생·헷지를 끄면 그 탭만 사라진다', () => {
    const { container } = render(
      <ModeTabs mode="spot" onChange={() => {}} showOptions={false} />,
    )
    const l = labels(container)
    expect(l).toHaveLength(2)
    expect(l.some((t) => t.includes('파생'))).toBe(false)
    expect(l.some((t) => t.includes('예금'))).toBe(true)
  })

  it('예금을 끄면 그 탭만 사라진다', () => {
    const { container } = render(
      <ModeTabs mode="spot" onChange={() => {}} showSavings={false} />,
    )
    const l = labels(container)
    expect(l).toHaveLength(2)
    expect(l.some((t) => t.includes('예금'))).toBe(false)
  })

  it('둘 다 끄면 고를 게 없으므로 탭 바 자체를 안 그린다', () => {
    const { container } = render(
      <ModeTabs mode="spot" onChange={() => {}} showOptions={false} showSavings={false} />,
    )
    expect(container.querySelector('.mode-tabs')).toBeNull()
  })

  it('주식 매매는 끌 수 없다 (항상 남는다)', () => {
    const { container } = render(
      <ModeTabs mode="spot" onChange={() => {}} showOptions={false} />,
    )
    expect(labels(container).some((t) => t.includes('주식 매매'))).toBe(true)
  })
})
