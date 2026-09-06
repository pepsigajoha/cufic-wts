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

describe('분기별 거시 파라미터 — 63일마다 macro 7요인 교체', () => {
  // 부분 macro만 준다(엔진이 defaultMacro로 채운다). base: {unemp:3,gdp:3,int_r:2,inf:2,sent:50,fx:1300,oil:75}
  const Q = (quarter, macro) => ({ quarter, macro, eventNews: '', hintText: '' })
  const BOOM = { gdp: 6, sent: 70, int_r: 1.5 }
  const CRISIS = { int_r: 6, gdp: -3, unemp: 7, inf: 6, sent: 20, fx: 1550 }

  it('quarters 길이가 4가 아니면 throw', () => {
    expect(() =>
      simulateNextRound({ stockIds: IDS, currentPrices: CUR, seed: 1, quarters: [Q(1, BOOM)] }),
    ).toThrow()
    expect(() => generatePriceSeries({ stockIds: IDS, years: ['2021'], seed: 1, quarters: 'nope' })).toThrow()
  })

  it('분기에 macro 객체가 없으면 throw', () => {
    const bad = [Q(1, BOOM), { quarter: 2, eventNews: '', hintText: '' }, Q(3, BOOM), Q(4, BOOM)]
    expect(() => simulateNextRound({ stockIds: IDS, currentPrices: CUR, seed: 1, quarters: bad })).toThrow()
  })

  it('quarters 미지정이면 기존 결과와 완전히 동일 (하위호환)', () => {
    const a = simulateNextRound({ stockIds: IDS, currentPrices: CUR, seed: 4, returnPath: true })
    const b = simulateNextRound({ stockIds: IDS, currentPrices: CUR, seed: 4, quarters: undefined, returnPath: true })
    expect(a).toEqual(b)
  })

  it('분기 경계(63/126/189)에서 가격이 이어진다 — 재시드·수직 갭 없음', () => {
    // 호황↔위기를 번갈아 붙여도 경계 일간 변동이 그 분기 내부 최대 일변동보다 크지 않아야(갭 없음).
    const quarters = [Q(1, BOOM), Q(2, CRISIS), Q(3, BOOM), Q(4, CRISIS)]
    const path = simulateNextRound({ stockIds: IDS, currentPrices: CUR, seed: 8, quarters, returnPath: true })
    for (const id of IDS) {
      const p = path[id]
      expect(p).toHaveLength(252)
      for (const b of [63, 126, 189]) {
        const seg = p.slice(b, b + 63)
        const maxDaily = Math.max(...seg.slice(1).map((v, i) => Math.abs(Math.log(v / seg[i]))))
        expect(Math.abs(Math.log(p[b] / p[b - 1]))).toBeLessThanOrEqual(maxDaily + 1e-9)
      }
    }
  })

  it('연말 확정가 불변식 유지 — path[251] = 끝값 모드', () => {
    const quarters = [Q(1, BOOM), Q(2, CRISIS), Q(3, { gdp: 1 }), Q(4, { gdp: 4, int_r: 2.5 })]
    const end = simulateNextRound({ stockIds: IDS, currentPrices: CUR, seed: 11, quarters })
    const path = simulateNextRound({ stockIds: IDS, currentPrices: CUR, seed: 11, quarters, returnPath: true })
    for (const id of IDS) expect(path[id][251]).toBe(end[id])
  })

  it('레짐 전환 — 같은 시드, 나쁜 거시(저성장·고금리)가 좋은 거시(고성장)보다 끝값이 낮다', () => {
    // 엔진은 드리프트를 ±0.6/년으로 클램프하므로 "한 방 폭락"이 아니라 매일 조금씩 눌린다 —
    // 같은 시드로 두 시나리오를 돌려 252일 복리 차이를 본다(확률적 노이즈에 안 흔들리게).
    const g4 = (o) => [Q(1, o), Q(2, o), Q(3, o), Q(4, o)]
    const g = simulateNextRound({ stockIds: IDS, currentPrices: CUR, seed: 5, quarters: g4({ gdp: 5, sent: 62 }) })
    const b = simulateNextRound({ stockIds: IDS, currentPrices: CUR, seed: 5, quarters: g4({ gdp: 0, int_r: 4 }) })
    for (const id of IDS) expect(b[id]).toBeLessThan(g[id])
  })

  it('분기별로 다르게 적용된다 — Q2만 나쁘게 바꾸면 딱 Q2부터 갈린다', () => {
    const base = { gdp: 4 }
    const a = simulateNextRound({
      stockIds: IDS, currentPrices: CUR, seed: 7, returnPath: true,
      quarters: [Q(1, base), Q(2, base), Q(3, base), Q(4, base)],
    })
    const c = simulateNextRound({
      stockIds: IDS, currentPrices: CUR, seed: 7, returnPath: true,
      quarters: [Q(1, base), Q(2, { gdp: -1, int_r: 4 }), Q(3, base), Q(4, base)],
    })
    for (const id of IDS) {
      for (let i = 0; i < 63; i++) expect(c[id][i]).toBe(a[id][i]) // Q1은 동일
      expect(c[id][125]).toBeLessThan(a[id][125]) // Q2 끝엔 나쁜 쪽이 더 낮다
    }
  })

  it('generatePriceSeries에도 분기 파라미터가 매 연도 적용된다 (같은 시드 비교)', () => {
    const g4 = (o) => [Q(1, o), Q(2, o), Q(3, o), Q(4, o)]
    const g = generatePriceSeries({ stockIds: IDS, years: ['2021', '2022'], seed: 6, quarters: g4({ gdp: 5, sent: 62 }) })
    const b = generatePriceSeries({ stockIds: IDS, years: ['2021', '2022'], seed: 6, quarters: g4({ gdp: 0, int_r: 4 }) })
    for (const id of IDS) for (const y of ['2021', '2022']) expect(b[id][y]).toBeLessThan(g[id][y])
  })
})
