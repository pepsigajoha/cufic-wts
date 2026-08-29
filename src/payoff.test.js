import { describe, it, expect } from 'vitest'
import { spotPnlPerShare, hedgedPnlPerShare, floorLoss, breakeven, buildPayoffSeries } from './payoff'

describe('spotPnlPerShare', () => {
  it('가격이 오르면 양수, 내리면 음수', () => {
    expect(spotPnlPerShare(11000, 10000)).toBe(1000)
    expect(spotPnlPerShare(9000, 10000)).toBe(-1000)
  })
})

describe('hedgedPnlPerShare', () => {
  const entry = 10000
  const strike = 10000
  const premium = 300

  it('행사가 이상에서는 주식 손익과 같은 기울기, 프리미엄만큼 아래로 이동', () => {
    expect(hedgedPnlPerShare(12000, entry, strike, premium)).toBe(12000 - entry - premium)
  })

  it('행사가 미만에서는 바닥에 고정된다(더 손실이 안 커진다)', () => {
    const atStrike = hedgedPnlPerShare(strike, entry, strike, premium)
    const wayBelow = hedgedPnlPerShare(strike - 5000, entry, strike, premium)
    expect(wayBelow).toBe(atStrike)
  })

  it('바닥값은 floorLoss()와 정확히 일치한다', () => {
    expect(hedgedPnlPerShare(1, entry, strike, premium)).toBe(floorLoss(entry, strike, premium))
  })
})

describe('breakeven', () => {
  it('진입가 + 프리미엄 지점에서 헷지 손익이 정확히 0이다', () => {
    const entry = 10000
    const strike = 10000
    const premium = 300
    const be = breakeven(entry, premium)
    expect(hedgedPnlPerShare(be, entry, strike, premium)).toBeCloseTo(0, 6)
  })
})

describe('buildPayoffSeries', () => {
  it('요청한 점 개수만큼 두 시리즈를 만들고, 오름차순 도메인을 돌려준다', () => {
    const { unhedged, hedged, domain } = buildPayoffSeries(10000, 10000, 300, { points: 10 })
    expect(unhedged).toHaveLength(10)
    expect(hedged).toHaveLength(10)
    expect(domain.min).toBeLessThan(domain.max)
  })

  it('points를 안 주면 진입가의 절반~1.5배를 기본 범위로 쓴다', () => {
    const { domain } = buildPayoffSeries(10000, 9000, 200)
    expect(domain.min).toBe(5000)
    expect(domain.max).toBe(15000)
  })
})
