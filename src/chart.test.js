import { describe, it, expect } from 'vitest'
import { downsample, priceAxis, roundStepIndex, STEPS_PER_YEAR, TIMEFRAMES } from './chart'

describe('roundStepIndex — 라운드 진행률 → 스텝(0..251) [SQL private.round_step_idx와 동일 공식]', () => {
  const T0 = Date.parse('2026-08-30T00:00:00Z')
  const g = (startMs, endMs, extra = {}) => ({
    round_start_at: startMs == null ? null : new Date(startMs).toISOString(),
    round_ends_at: endMs == null ? null : new Date(endMs).toISOString(),
    ...extra,
  })

  it('시작 직후엔 0', () => {
    expect(roundStepIndex(g(T0, T0 + 600_000), T0)).toBe(0)
  })

  it('정확히 절반 지나면 126 (0.5 × 252)', () => {
    expect(roundStepIndex(g(T0, T0 + 600_000), T0 + 300_000)).toBe(126)
  })

  it('마감 시각/그 이후엔 마지막 스텝(251)로 클램프', () => {
    expect(roundStepIndex(g(T0, T0 + 600_000), T0 + 600_000)).toBe(251)
    expect(roundStepIndex(g(T0, T0 + 600_000), T0 + 999_000)).toBe(251)
  })

  it('시작 전(now < start)이면 0으로 클램프', () => {
    expect(roundStepIndex(g(T0, T0 + 600_000), T0 - 5_000)).toBe(0)
  })

  it('round_start_at이 없으면 251 (연말가 = current_price와 동일)', () => {
    expect(roundStepIndex(g(null, T0 + 600_000), T0 + 300_000)).toBe(251)
  })

  it('is_locked면 진행 중이라도 251', () => {
    expect(roundStepIndex(g(T0, T0 + 600_000, { is_locked: true }), T0 + 60_000)).toBe(251)
  })

  it('일시정지(round_paused_at) 중이면 그 시각 진행률에서 얼린다 (now가 흘러도 불변)', () => {
    const paused = g(T0, T0 + 600_000, { round_paused_at: new Date(T0 + 150_000).toISOString() })
    // now가 300s(절반)든 590s든, paused=150s(1/4) 시점 스텝 63으로 고정
    expect(roundStepIndex(paused, T0 + 300_000)).toBe(63)
    expect(roundStepIndex(paused, T0 + 590_000)).toBe(63)
  })

  it('날짜가 깨졌거나 span<=0이어도 죽지 않고 251', () => {
    expect(roundStepIndex({ round_start_at: 'nope', round_ends_at: 'nan' }, T0)).toBe(251)
    expect(roundStepIndex(g(T0 + 600_000, T0), T0 + 60_000)).toBe(251)
    expect(roundStepIndex(null, T0)).toBe(251)
    expect(roundStepIndex({}, T0)).toBe(251)
  })

  it('항상 0..STEPS_PER_YEAR-1 범위', () => {
    for (const dt of [-1e6, 0, 1, 150_000, 599_999, 600_000, 1e7]) {
      const s = roundStepIndex(g(T0, T0 + 600_000), T0 + dt)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(STEPS_PER_YEAR - 1)
    }
  })
})

describe('downsample — 과거 라운드 경로를 n개 대표점으로', () => {
  it('첫 점과 마지막 점을 항상 포함한다', () => {
    const out = downsample([10, 20, 30, 40, 50], 3)
    expect(out[0]).toBe(10)
    expect(out[out.length - 1]).toBe(50)
  })

  it('요청 개수만큼 낸다 (경로가 그보다 길 때)', () => {
    expect(downsample(Array.from({ length: 252 }, (_, i) => i), 12)).toHaveLength(12)
  })

  it('n이 경로 길이 이상이면 원본을 그대로(사본으로) 돌려준다', () => {
    const src = [1, 2, 3]
    const out = downsample(src, 10)
    expect(out).toEqual([1, 2, 3])
    expect(out).not.toBe(src)
  })

  it('n=1이면 마지막 값만', () => {
    expect(downsample([1, 2, 3, 9], 1)).toEqual([9])
  })

  it('빈/비배열 입력이면 빈 배열', () => {
    expect(downsample([], 5)).toEqual([])
    expect(downsample(null, 5)).toEqual([])
  })

  it('균등 간격으로 뽑는다', () => {
    expect(downsample([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3)).toEqual([0, 5, 10])
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
    expect(max).toBeGreaterThan(min)
  })

  it('가격이 전부 0(거래정지)이어도 NaN 없이 안전한 도메인을 낸다', () => {
    const { min, max, ticks } = priceAxis(Array(5).fill(0))
    expect(Number.isFinite(min)).toBe(true)
    expect(max).toBeGreaterThan(min)
    expect(ticks.every(Number.isFinite)).toBe(true)
  })

  it('NaN/undefined가 섞여 있어도 유한값만 써서 안전하다', () => {
    const { min, max } = priceAxis([10_000, NaN, undefined, 12_000])
    expect(Number.isFinite(min)).toBe(true)
    expect(max).toBeGreaterThan(min)
  })

  it('빈 배열이어도 죽지 않고 안전한 기본 도메인을 낸다', () => {
    const { min, max, ticks } = priceAxis([])
    expect(Number.isFinite(min)).toBe(true)
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
  it('"틱"이 가장 촘촘하고 STEPS_PER_YEAR 해상도다', () => {
    const tick = TIMEFRAMES.find((t) => t.key === 'T')
    expect(tick.count).toBe(STEPS_PER_YEAR)
    expect(tick.count).toBeGreaterThan(Math.max(...TIMEFRAMES.filter((t) => t.key !== 'T').map((t) => t.count)))
  })

  it('전부 서로 다른 다운샘플 개수를 쓴다', () => {
    const counts = TIMEFRAMES.map((t) => t.count)
    expect(new Set(counts).size).toBe(TIMEFRAMES.length)
  })
})
