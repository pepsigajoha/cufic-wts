import { describe, it, expect } from 'vitest'
import { simulateNextRound, generatePriceSeries } from './priceSim'

const IDS = ['S01', 'S02', 'S03']
const CUR = { S01: 10_000, S02: 12_000, S03: 8_000 }

describe('simulateNextRound — returnPath (엔진 트랙: raw 252 경로)', () => {
  it('returnPath 없으면 종목당 정수 하나(끝값)만 돌려준다', () => {
    const r = simulateNextRound({ stockIds: IDS, currentPrices: CUR, seed: 7 })
    for (const id of IDS) expect(Number.isInteger(r[id])).toBe(true)
  })

  it('returnPath:true면 종목당 정확히 252개 정수 배열', () => {
    const r = simulateNextRound({ stockIds: IDS, currentPrices: CUR, seed: 7, returnPath: true })
    for (const id of IDS) {
      expect(Array.isArray(r[id])).toBe(true)
      expect(r[id]).toHaveLength(252)
      expect(r[id].every((v) => Number.isInteger(v) && v >= 0)).toBe(true)
    }
  })

  it('경로의 마지막 값 = 같은 시드로 끝값 모드를 돌린 결과 (핀·보정 없음)', () => {
    const end = simulateNextRound({ stockIds: IDS, currentPrices: CUR, seed: 42 })
    const path = simulateNextRound({ stockIds: IDS, currentPrices: CUR, seed: 42, returnPath: true })
    for (const id of IDS) expect(path[id][251]).toBe(end[id])
  })

  it('같은 시드면 경로도 결정론적으로 동일', () => {
    const a = simulateNextRound({ stockIds: IDS, currentPrices: CUR, seed: 1, returnPath: true })
    const b = simulateNextRound({ stockIds: IDS, currentPrices: CUR, seed: 1, returnPath: true })
    expect(a).toEqual(b)
  })
})

describe('generatePriceSeries — returnPath (다연도 배치)', () => {
  const YEARS = ['2021', '2022', '2023']

  it('returnPath 없으면 { [id]: { [year]: 정수 } }', () => {
    const r = generatePriceSeries({ stockIds: IDS, years: YEARS, seed: 3 })
    expect(Number.isInteger(r.S01['2021'])).toBe(true)
  })

  it('returnPath:true면 { [id]: { [year]: number[252] } }', () => {
    const r = generatePriceSeries({ stockIds: IDS, years: YEARS, seed: 3, returnPath: true })
    for (const id of IDS)
      for (const y of YEARS) {
        expect(r[id][y]).toHaveLength(252)
        expect(r[id][y].every((v) => Number.isInteger(v) && v >= 0)).toBe(true)
      }
  })

  it('각 연도 경로의 끝값 = 끝값 모드의 그 연도 값', () => {
    const end = generatePriceSeries({ stockIds: IDS, years: YEARS, seed: 9 })
    const path = generatePriceSeries({ stockIds: IDS, years: YEARS, seed: 9, returnPath: true })
    for (const id of IDS) for (const y of YEARS) expect(path[id][y][251]).toBe(end[id][y])
  })
})
