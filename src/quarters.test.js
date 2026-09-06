import { describe, it, expect } from 'vitest'
import {
  QUARTER_LEN,
  QUARTER_STARTS,
  quarterAt,
  quarterOfStep,
  monthOfStep,
  isQuarterStart,
} from './quarters'

it('QUARTER_LEN = 63, 시작일 = [1, 64, 127, 190]', () => {
  expect(QUARTER_LEN).toBe(63)
  expect(QUARTER_STARTS).toEqual([1, 64, 127, 190])
})

describe('quarterAt — 거래일(1..252) → 분기(1..4)', () => {
  it('분기 경계', () => {
    expect(quarterAt(1)).toBe(1)
    expect(quarterAt(63)).toBe(1)
    expect(quarterAt(64)).toBe(2)
    expect(quarterAt(126)).toBe(2)
    expect(quarterAt(127)).toBe(3)
    expect(quarterAt(189)).toBe(3)
    expect(quarterAt(190)).toBe(4)
    expect(quarterAt(252)).toBe(4)
  })
  it('범위 밖은 클램프', () => {
    expect(quarterAt(0)).toBe(1)
    expect(quarterAt(-5)).toBe(1)
    expect(quarterAt(999)).toBe(4)
  })
})

describe('quarterOfStep — 스텝(0..251) → 분기', () => {
  it('roundStepIndex 산출물과 정합', () => {
    expect(quarterOfStep(0)).toBe(1)
    expect(quarterOfStep(62)).toBe(1)
    expect(quarterOfStep(63)).toBe(2)
    expect(quarterOfStep(189)).toBe(4)
    expect(quarterOfStep(251)).toBe(4)
  })
})

describe('monthOfStep — 스텝(0..251) → 가상 월(1..12)', () => {
  it('분기 경계와 월이 맞는다 (21일=1개월)', () => {
    expect(monthOfStep(0)).toBe(1)
    expect(monthOfStep(62)).toBe(3) // Q1 끝 = 3월
    expect(monthOfStep(63)).toBe(4) // Q2 시작 = 4월
    expect(monthOfStep(125)).toBe(6)
    expect(monthOfStep(126)).toBe(7)
    expect(monthOfStep(251)).toBe(12)
  })
  it('범위 밖 클램프', () => {
    expect(monthOfStep(-10)).toBe(1)
    expect(monthOfStep(9999)).toBe(12)
  })
})

describe('isQuarterStart — 분기 첫날만 true', () => {
  it('1/64/127/190에서만', () => {
    for (const d of [1, 64, 127, 190]) expect(isQuarterStart(d)).toBe(true)
    for (const d of [2, 63, 65, 126, 128, 189, 191, 252]) expect(isQuarterStart(d)).toBe(false)
  })
})

