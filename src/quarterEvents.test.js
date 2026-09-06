import { describe, it, expect, afterEach } from 'vitest'
import { quarterEvent } from './quarterEvents'

afterEach(() => {
  try {
    sessionStorage.removeItem('wts-quarter-events')
  } catch {
    /* jsdom 없는 환경 방어 */
  }
})

describe('quarterEvent — 임시 config + sessionStorage 덮어쓰기', () => {
  it('덮어쓰기 없으면 기본 문구', () => {
    expect(quarterEvent(1, 2).news).toMatch(/2분기/)
    expect(quarterEvent(1, 5)).toBeNull() // 정의 안 된 분기
  })

  it('분기 키만 있는 덮어쓰기가 우선한다', () => {
    sessionStorage.setItem('wts-quarter-events', JSON.stringify({ 2: { news: '커스텀 속보' } }))
    expect(quarterEvent(1, 2).news).toBe('커스텀 속보')
  })

  it('라운드별 덮어쓰기가 분기 전역보다 우선한다', () => {
    sessionStorage.setItem(
      'wts-quarter-events',
      JSON.stringify({ 2: { news: '전역' }, 3: { 2: { news: '3라운드 전용' } } }),
    )
    expect(quarterEvent(3, 2).news).toBe('3라운드 전용')
    expect(quarterEvent(1, 2).news).toBe('전역')
  })

  it('깨진 JSON은 무시하고 기본값', () => {
    sessionStorage.setItem('wts-quarter-events', '{ not json')
    expect(quarterEvent(1, 3).news).toMatch(/3분기/)
  })
})
