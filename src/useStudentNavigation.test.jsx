import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStudentNavigation } from './useStudentNavigation'

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  window.history.replaceState({ existing: 'preserved' }, '')
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('휴대폰 뒤로가기', () => {
  it('실제 방문 기록으로 주문 → 상세 → 목록 복귀 및 앞으로가기를 수행한다', async () => {
    const { result } = renderHook(useStudentNavigation)
    act(() => result.current.setView('analysis'))
    act(() => result.current.setView('order'))
    const length = window.history.length
    act(() => window.history.back())
    await waitFor(() => expect(result.current.view).toBe('analysis'))
    act(() => window.history.back())
    await waitFor(() => expect(result.current.view).toBe('stocks'))
    act(() => window.history.forward())
    await waitFor(() => expect(result.current.view).toBe('analysis'))
    act(() => window.history.forward())
    await waitFor(() => expect(result.current.view).toBe('order'))
    expect(window.history.length).toBe(length)
    expect(window.history.state.existing).toBe('preserved')
  })

  it('목록 복귀 버튼이 주문으로 돌아가는 새 방문 기록을 만들지 않는다', async () => {
    const { result } = renderHook(useStudentNavigation)
    act(() => result.current.setView('analysis'))
    act(() => result.current.setView('order'))
    act(() => result.current.setView('stocks'))
    await waitFor(() => expect(window.history.state.cuficStudentNavigation.view).toBe('stocks'))
    act(() => window.history.forward())
    await waitFor(() => expect(result.current.view).toBe('analysis'))
  })

  it('예금에서 파생 탭으로 바꾼 뒤 뒤로가면 종목 목록을 보여준다', async () => {
    const { result } = renderHook(useStudentNavigation)
    act(() => { result.current.setMode('savings'); result.current.setView('order') })
    act(() => { result.current.setMode('hedge'); result.current.setView('analysis') })
    await waitFor(() => expect(window.history.state.cuficStudentNavigation.mode).toBe('hedge'))
    act(() => window.history.back())
    await waitFor(() => expect(result.current.view).toBe('stocks'))
    expect(result.current.mode).toBe('spot')
  })

  it('노트북에서는 화면 전환을 방문 기록에 추가하지 않는다', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const length = window.history.length
    const { result } = renderHook(useStudentNavigation)
    act(() => result.current.setView('analysis'))
    act(() => result.current.setView('order'))
    expect(result.current.view).toBe('order')
    expect(window.history.length).toBe(length)
    expect(window.history.state.cuficStudentNavigation).toBeUndefined()
  })

  it('탭을 빠르게 두 번 바꿔도 마지막 선택의 뒤로가기 경로를 유지한다', async () => {
    const { result } = renderHook(useStudentNavigation)
    act(() => { result.current.setMode('savings'); result.current.setView('order') })
    act(() => { result.current.setMode('hedge'); result.current.setView('analysis') })
    act(() => result.current.setMode('spot'))
    await waitFor(() => expect(window.history.state.cuficStudentNavigation).toMatchObject({ view: 'analysis', mode: 'spot' }))
    act(() => window.history.back())
    await waitFor(() => expect(result.current.view).toBe('stocks'))
  })
})
