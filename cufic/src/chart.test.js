import { describe, it, expect } from 'vitest'
import { closePath, syntheticAnchor, priceAxis, TIMEFRAMES } from './chart'

describe('closePath — 구간 가격 경로 [순수 함수]', () => {
  it('첫 점은 정확히 fromPrice, 마지막 점은 정확히 toPrice다(구간 경계가 안 끊기게)', () => {
    const p = closePath('S01:2021-2022', 9_000, 12_000, 20, 0.03)
    expect(p[0]).toBe(9_000)
    expect(p[p.length - 1]).toBe(12_000)
  })

  it('하락 구간에서도 끝점은 정확히 목표가다', () => {
    const p = closePath('S01:2022-2023', 12_000, 7_500, 20, 0.03)
    expect(p[0]).toBe(12_000)
    expect(p[p.length - 1]).toBe(7_500)
  })

  it('count=1이면 목표가 하나만 돌려준다', () => {
    expect(closePath('S01', 10_000, 12_000, 1, 0.03)).toEqual([12_000])
  })

  it('같은 시드·구간이면 항상 같은 경로다 (결정론적)', () => {
    const a = closePath('S01:2021-2022', 9_000, 12_000, 20, 0.03)
    const b = closePath('S01:2021-2022', 9_000, 12_000, 20, 0.03)
    expect(a).toEqual(b)
  })

  it('시드 문자열이 다르면 경로도 다르다', () => {
    const a = closePath('S01:2021-2022', 9_000, 12_000, 20, 0.03)
    const b = closePath('S02:2021-2022', 9_000, 12_000, 20, 0.03)
    expect(a).not.toEqual(b)
  })

  it('fromPrice가 0(과거 거래정지)이어도 NaN 없이 toPrice로 수렴한다', () => {
    const p = closePath('S01', 0, 10_000, 20, 0.03)
    expect(p.every(Number.isFinite)).toBe(true)
    expect(p[p.length - 1]).toBe(10_000)
  })

  it('toPrice가 0(신규 거래정지)이어도 NaN 없이 안전하다', () => {
    const p = closePath('S01', 10_000, 0, 20, 0.03)
    expect(p.every(Number.isFinite)).toBe(true)
    expect(p[p.length - 1]).toBe(0)
  })

  it('요청한 개수만큼 점을 낸다', () => {
    expect(closePath('S01', 10_000, 11_000, 47, 0.03)).toHaveLength(47)
  })
})

describe('syntheticAnchor — 게임 시작 전 가상 기준점', () => {
  it('R1가 양수면 그 근방의(±12%) 고정값을 낸다', () => {
    const a = syntheticAnchor('S01', 10_000)
    expect(a).toBeGreaterThan(10_000 * 0.85)
    expect(a).toBeLessThan(10_000 * 1.15)
  })

  it('종목코드가 다르면 다른 값이 나온다', () => {
    expect(syntheticAnchor('S01', 10_000)).not.toBe(syntheticAnchor('S02', 10_000))
  })

  it('같은 입력이면 항상 같은 값이다(결정론적)', () => {
    expect(syntheticAnchor('S01', 10_000)).toBe(syntheticAnchor('S01', 10_000))
  })

  it('R1가 0/음수여도 죽지 않는다', () => {
    expect(Number.isFinite(syntheticAnchor('S01', 0))).toBe(true)
    expect(Number.isFinite(syntheticAnchor('S01', -5))).toBe(true)
  })
})

describe('priceAxis — y축 좌표 스케일링 [순수 함수]', () => {
  it('일반적인 경로에서 min < max 이고 여백을 둔다', () => {
    const { min, max } = priceAxis([9_500, 11_000, 10_200, 10_800])
    expect(min).toBeLessThan(9_500)
    expect(max).toBeGreaterThan(11_000)
  })

  it('변동성 0(전부 동일값)이어도 min < max — 0으로 나누지 않는다', () => {
    const { min, max } = priceAxis(Array(5).fill(10_000))
    expect(Number.isFinite(min)).toBe(true)
    expect(Number.isFinite(max)).toBe(true)
    expect(max).toBeGreaterThan(min)
  })

  it('가격이 전부 0(거래정지)이어도 NaN 없이 안전한 도메인을 낸다', () => {
    const { min, max, ticks } = priceAxis(Array(5).fill(0))
    expect(Number.isFinite(min)).toBe(true)
    expect(Number.isFinite(max)).toBe(true)
    expect(max).toBeGreaterThan(min)
    expect(ticks.every(Number.isFinite)).toBe(true)
  })

  it('점이 하나뿐이어도 안전하다', () => {
    const { min, max } = priceAxis([5_000])
    expect(max).toBeGreaterThan(min)
  })

  it('빈 배열이어도 죽지 않고 안전한 기본 도메인을 낸다', () => {
    const { min, max, ticks } = priceAxis([])
    expect(Number.isFinite(min)).toBe(true)
    expect(Number.isFinite(max)).toBe(true)
    expect(max).toBeGreaterThan(min)
    expect(ticks).toEqual([])
  })

  it('눈금은 항상 [min,max] 범위 안에 있다', () => {
    const { min, max, ticks } = priceAxis([98_765, 123_456, 100_000, 110_000])
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(min)
      expect(t).toBeLessThanOrEqual(max)
    }
  })
})

describe('TIMEFRAMES', () => {
  it('실시간 라이브 구간용 "틱" 단위가 있고, 가장 촘촘하다', () => {
    const tick = TIMEFRAMES.find((t) => t.key === 'T')
    expect(tick).toBeTruthy()
    expect(tick.count).toBeGreaterThan(Math.max(...TIMEFRAMES.filter((t) => t.key !== 'T').map((t) => t.count)))
  })

  it('일/주/월/년 전부 서로 다른 점 개수를 쓴다(그래프 모양이 달라짐)', () => {
    const counts = TIMEFRAMES.map((t) => t.count)
    expect(new Set(counts).size).toBe(TIMEFRAMES.length)
  })
})
