import { describe, it, expect, beforeEach } from 'vitest'
import { getGeminiKey, setGeminiKey, clearGeminiKey, hasGeminiKey, callGemini } from './gemini'

beforeEach(() => clearGeminiKey())

describe('gemini 키 저장 (sessionStorage)', () => {
  it('저장·조회·삭제가 왕복한다', () => {
    expect(hasGeminiKey()).toBe(false)
    setGeminiKey('  AIzaTEST  ')
    expect(getGeminiKey()).toBe('AIzaTEST') // trim
    expect(hasGeminiKey()).toBe(true)
    clearGeminiKey()
    expect(hasGeminiKey()).toBe(false)
    expect(getGeminiKey()).toBe('')
  })

  it('빈 값으로 저장하면 삭제된다', () => {
    setGeminiKey('x')
    setGeminiKey('')
    expect(hasGeminiKey()).toBe(false)
  })
})

describe('callGemini', () => {
  it('키가 없으면 no_gemini_key 를 던진다', async () => {
    await expect(callGemini('아무 프롬프트')).rejects.toThrow('no_gemini_key')
  })
})
