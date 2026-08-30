import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./gemini', () => ({
  hasGeminiKey: vi.fn(() => true),
  callGemini: vi.fn(),
}))

import { refineHintHeadlines } from './hintService'
import { hasGeminiKey, callGemini } from './gemini'

const HINTS = [
  { grade: 'S', round: 2, impact: 'up', related_stock_ids: ['S1'], headline: '템플릿 A' },
  { grade: 'A', round: 2, impact: 'down', related_stock_ids: ['S2'], headline: '템플릿 B' },
]
const NAMES = { S1: '가나전자', S2: '다라화학' }

beforeEach(() => {
  vi.clearAllMocks()
  hasGeminiKey.mockReturnValue(true)
})

describe('refineHintHeadlines', () => {
  it('키가 없으면 원본 유지 (source template)', async () => {
    hasGeminiKey.mockReturnValue(false)
    const r = await refineHintHeadlines(HINTS, NAMES)
    expect(r.source).toBe('template')
    expect(r.hints).toBe(HINTS)
  })

  it('빈 배열이면 그대로', async () => {
    const r = await refineHintHeadlines([], NAMES)
    expect(r).toEqual({ hints: [], source: 'template' })
    expect(callGemini).not.toHaveBeenCalled()
  })

  it('정상 응답이면 헤드라인만 교체, impact·grade·related 는 불변', async () => {
    callGemini.mockResolvedValue({ headlines: ['새 헤드라인 1', '새 헤드라인 2'] })
    const r = await refineHintHeadlines(HINTS, NAMES)
    expect(r.source).toBe('gemini')
    expect(r.hints.map((h) => h.headline)).toEqual(['새 헤드라인 1', '새 헤드라인 2'])
    expect(r.hints.map((h) => [h.grade, h.impact, h.related_stock_ids[0], h.round])).toEqual([
      ['S', 'up', 'S1', 2],
      ['A', 'down', 'S2', 2],
    ])
  })

  it('응답 길이가 안 맞으면 원본 유지 + error', async () => {
    callGemini.mockResolvedValue({ headlines: ['하나뿐'] })
    const r = await refineHintHeadlines(HINTS, NAMES)
    expect(r.source).toBe('template')
    expect(r.hints).toBe(HINTS)
    expect(r.error).toBeTruthy()
  })

  it('호출이 throw 하면 원본 유지', async () => {
    callGemini.mockRejectedValue(new Error('gemini_http_429'))
    const r = await refineHintHeadlines(HINTS, NAMES)
    expect(r.source).toBe('template')
    expect(r.hints).toBe(HINTS)
  })
})
