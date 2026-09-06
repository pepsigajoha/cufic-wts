import { describe, it, expect } from 'vitest'
import { defaultQuarterConfigs, isValidQuarterConfigs, normalizeQuarterConfigs } from './quarterConfig'
import { MACRO_KEYS } from './macroFields'

describe('defaultQuarterConfigs', () => {
  it('4분기 · 각 분기에 거시 7요인 + 빈 속보/힌트', () => {
    const q = defaultQuarterConfigs()
    expect(q).toHaveLength(4)
    q.forEach((c, i) => {
      expect(c.quarter).toBe(i + 1)
      expect(c.eventNews).toBe('')
      expect(c.hintText).toBe('')
      MACRO_KEYS.forEach((k) => expect(Number.isFinite(c.macro[k])).toBe(true))
    })
  })
})

describe('isValidQuarterConfigs', () => {
  it('길이 4 + 각 분기 macro 7요인 유한', () => {
    expect(isValidQuarterConfigs(defaultQuarterConfigs())).toBe(true)
    expect(isValidQuarterConfigs([])).toBe(false)
    expect(isValidQuarterConfigs(null)).toBe(false)
    expect(isValidQuarterConfigs(defaultQuarterConfigs().slice(0, 3))).toBe(false)
  })
  it('macro 없거나 NaN이면 false', () => {
    const noMacro = defaultQuarterConfigs()
    delete noMacro[1].macro
    expect(isValidQuarterConfigs(noMacro)).toBe(false)
    const nan = defaultQuarterConfigs()
    nan[0].macro.int_r = Number.NaN
    expect(isValidQuarterConfigs(nan)).toBe(false)
  })
})

describe('normalizeQuarterConfigs — 부분 macro를 기본값으로 채운다', () => {
  it('일부 키만 준 프리셋도 완전한 7요인이 된다', () => {
    const out = normalizeQuarterConfigs([
      { quarter: 1, macro: { gdp: 4 } },
      { quarter: 2, macro: { int_r: 5.5, gdp: -1.5 }, eventNews: '위기' },
      { quarter: 3, macro: {} },
      { quarter: 4, macro: { sent: 60 } },
    ])
    expect(isValidQuarterConfigs(out)).toBe(true)
    expect(out[0].macro.gdp).toBe(4)
    expect(out[1].macro.int_r).toBe(5.5)
    expect(out[1].eventNews).toBe('위기')
    expect(out[2].eventNews).toBe('') // 미지정 → 빈 문자열
    MACRO_KEYS.forEach((k) => expect(Number.isFinite(out[2].macro[k])).toBe(true))
  })
})
