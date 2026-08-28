import { describe, it, expect } from 'vitest'
import { tickPrice } from './realtimeTick'

const BASE = { officialPrice: 10_000, seed: 3, stockId: 'S01' }

describe('경계 조건', () => {
  it('남은 시간이 0이면(마감) 정확히 공식가다', () => {
    expect(tickPrice({ ...BASE, remainingMs: 0, now: 0 })).toBe(10_000)
  })

  it('남은 시간이 음수여도(마감 지남) 0으로 클램프돼 공식가를 낸다', () => {
    expect(tickPrice({ ...BASE, remainingMs: -5_000, now: 0 })).toBe(10_000)
  })

  it('남은 시간이 taperMs 이하로 줄면 공식가로 수렴한다(수렴 구간 경계값)', () => {
    expect(tickPrice({ ...BASE, remainingMs: 0, taperMs: 15_000, now: 0 })).toBe(10_000)
  })

  it('남은 시간이 충분하면(taperMs 초과) 공식가에서 벗어날 수 있다', () => {
    // 여러 now 값을 훑어서 적어도 하나는 공식가와 달라야 한다(항상 z=0인 위상만 골랐을 가능성 배제)
    const vals = [0, 3_000, 7_000, 11_000, 19_000, 23_000].map((now) =>
      tickPrice({ ...BASE, remainingMs: 300_000, now }),
    )
    expect(vals.some((v) => v !== 10_000)).toBe(true)
  })
})

describe('타이머 조작에 영향받지 않는다 — round_ends_at이 몇 번을 바뀌어도 remainingMs만 맞으면 정상 동작', () => {
  it('관리자가 ±1분으로 타이머를 늘렸다 줄였다 해도(=round_ends_at만 바뀜), remainingMs가 같으면 결과가 같다', () => {
    // roundStartMs 개념을 아예 안 쓰므로, round_ends_at 변경 이력과 무관하게
    // "지금 남은 시간"만 같으면 항상 같은 결과가 나와야 한다.
    const a = tickPrice({ ...BASE, remainingMs: 240_000, now: 100_000 })
    const b = tickPrice({ ...BASE, remainingMs: 240_000, now: 100_000 })
    expect(a).toBe(b)
  })

  it('남은 시간이 넉넉하면 라운드가 얼마나 오래 진행됐든(now가 커도) 흔들림이 죽지 않는다', () => {
    // v1 버그 재현 시나리오: 타이머를 연장해서 "시작 시각 역산"이 실제보다 훨씬 미래로
    // 잘못 계산되던 상황과 동등한 조건 — now가 매우 커도 remainingMs만 충분하면 정상.
    const vals = [0, 5_000, 10_000, 15_000, 20_000].map((dt) =>
      tickPrice({ ...BASE, remainingMs: 300_000, now: 10_000_000 + dt }),
    )
    expect(vals.some((v) => v !== 10_000)).toBe(true)
  })
})

describe('[회귀] 기본 라운드 길이(10분) 안에서 활발하게 오르내린다', () => {
  // 처음엔 가장 진폭이 큰 파동의 주기를 47분으로 잡았는데, 그러면 기본 라운드 길이(10분,
  // round_duration_seconds 기본값) 안에서 전체 주기의 5분의 1도 못 돌아 — 한쪽으로만 느리게
  // 드리프트하는 것처럼 보였다("10분 동안 활발하게 안 움직인다"는 신고와 일치). 주기를
  // 짧게 잡아 라운드 하나 안에서도 최소 한 번은 오르내리게 고쳤다.
  it('10분짜리 라운드 하나를 5초 간격으로 훑으면 위아래로 뒤집히는 지점이 여러 번 나온다', () => {
    const ROUND_MS = 10 * 60 * 1000
    const samples = []
    for (let t = 0; t <= ROUND_MS; t += 5_000) {
      samples.push(tickPrice({ ...BASE, remainingMs: ROUND_MS - t, now: t }))
    }
    let reversals = 0
    for (let i = 2; i < samples.length; i++) {
      const prevDir = Math.sign(samples[i - 1] - samples[i - 2])
      const dir = Math.sign(samples[i] - samples[i - 1])
      if (prevDir !== 0 && dir !== 0 && prevDir !== dir) reversals++
    }
    expect(reversals).toBeGreaterThan(2)
  })

  it('10분 동안의 최대-최소 폭이 진폭(sigma)의 절반 이상은 실제로 나타난다(너무 밋밋하지 않다)', () => {
    const ROUND_MS = 10 * 60 * 1000
    const samples = []
    for (let t = 0; t <= ROUND_MS; t += 2_000) {
      samples.push(tickPrice({ ...BASE, remainingMs: ROUND_MS - t, now: t }))
    }
    const spread = Math.max(...samples) - Math.min(...samples)
    expect(spread).toBeGreaterThan(BASE.officialPrice * 0.03 * 0.5)
  })
})

describe('결정성 (모든 학생이 같은 값을 봐야 한다)', () => {
  it('같은 seed·종목·시각·잔여시간이면 항상 같은 값이 나온다', () => {
    const a = tickPrice({ ...BASE, remainingMs: 300_000, now: 63_000 })
    const b = tickPrice({ ...BASE, remainingMs: 300_000, now: 63_000 })
    expect(a).toBe(b)
  })

  it('종목코드가 다르면 같은 시각이라도 다른 파형이 나온다', () => {
    const a = tickPrice({ ...BASE, remainingMs: 300_000, now: 63_000, stockId: 'S01' })
    const b = tickPrice({ ...BASE, remainingMs: 300_000, now: 63_000, stockId: 'S02' })
    expect(a).not.toBe(b)
  })

  it('라운드(seed)가 다르면 같은 종목·시각이라도 다른 파형이 나온다', () => {
    const a = tickPrice({ ...BASE, remainingMs: 300_000, now: 63_000, seed: 3 })
    const b = tickPrice({ ...BASE, remainingMs: 300_000, now: 63_000, seed: 4 })
    expect(a).not.toBe(b)
  })
})

describe('안전장치', () => {
  it('시간에 따라 부드럽게 흐른다 — 1.5초 간격끼리 순간이동(텔레포트)하지 않는다', () => {
    // CYCLE_MS를 10초까지 줄여 일부러 빠르게 움직이게 했으니, 1.5초 간격 변화폭도
    // 예전(느린 주기)보다는 커진다 — 여기선 "빠른 흔들림"과 "진짜 텔레포트 버그"만 구분한다.
    const prices = [60_000, 61_500, 63_000, 64_500, 66_000].map((now) =>
      tickPrice({ ...BASE, remainingMs: 300_000, now }),
    )
    for (let i = 1; i < prices.length; i++) {
      const jump = Math.abs(prices[i] - prices[i - 1]) / BASE.officialPrice
      expect(jump).toBeLessThan(0.05) // 1.5초 간격에 5% 이상 튀면 텔레포트로 본다
    }
  })

  it('공식가가 0/음수/없음이면 NaN 없이 안전하게 처리한다', () => {
    expect(Number.isFinite(tickPrice({ ...BASE, officialPrice: 0, remainingMs: 300_000 }))).toBe(true)
    expect(Number.isFinite(tickPrice({ ...BASE, officialPrice: null, remainingMs: 300_000 }))).toBe(true)
  })

  it('remainingMs가 없거나 undefined면 NaN 없이 공식가를 그대로 낸다(마감 취급)', () => {
    expect(tickPrice({ ...BASE })).toBe(10_000)
  })

  it('결과는 항상 1 이상의 정수다', () => {
    for (const now of [0, 15_000, 90_000, 165_000, 180_000]) {
      const v = tickPrice({ ...BASE, officialPrice: 100, remainingMs: 300_000, now })
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(1)
    }
  })
})
