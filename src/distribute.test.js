import { describe, it, expect } from 'vitest'
import { distribute, sortPool, deriveRoundHints } from './distribute'

describe('힌트 자동 배분 (라운드로빈)', () => {
  // 7조 × 11힌트: S1 · A2 · B2 · C3 · D3 (입력은 섞여 있어도 sortPool이 정렬)
  const hints = [
    { id: 6, grade: 'D' },
    { id: 5, grade: 'S' },
    { id: 3, grade: 'A' },
    { id: 2, grade: 'C' },
    { id: 9, grade: 'A' },
    { id: 1, grade: 'B' },
    { id: 8, grade: 'D' },
    { id: 7, grade: 'B' },
    { id: 4, grade: 'C' },
    { id: 10, grade: 'D' },
    { id: 11, grade: 'C' },
  ]
  // 평가금액 오름차순: T0(꼴찌) … T6(1위)
  const teams = Array.from({ length: 7 }, (_, i) => ({ code: `T${i}`, equity: i * 100 }))

  const map = distribute(teams, hints)
  const gradesOf = (code) => (map.get(code) ?? []).map((h) => h.grade)

  it('모든 힌트가 지급된다 (11장)', () => {
    const total = [...map.values()].reduce((s, arr) => s + arr.length, 0)
    expect(total).toBe(11)
  })

  it('꼴찌(T0)는 S + C를 받는다', () => {
    expect(gradesOf('T0')).toEqual(['S', 'C'])
  })

  it('1위(T6)는 C 한 장을 받는다', () => {
    expect(gradesOf('T6')).toEqual(['C'])
  })

  it('하위 4개 조는 2장, 상위 3개 조는 1장', () => {
    const counts = teams.map((t) => (map.get(t.code) ?? []).length)
    expect(counts).toEqual([2, 2, 2, 2, 1, 1, 1]) // T0..T6 (꼴찌→1위)
  })

  it('sortPool: 등급 좋은 순 → 같은 등급은 작성순(id)', () => {
    const sorted = sortPool(hints)
    expect(sorted.map((h) => h.grade)).toEqual(['S', 'A', 'A', 'B', 'B', 'C', 'C', 'C', 'D', 'D', 'D'])
    expect(sorted.filter((h) => h.grade === 'A').map((h) => h.id)).toEqual([3, 9])
  })
})

describe('deriveRoundHints (엔진 수익률 → 힌트 풀)', () => {
  const RET = [
    { stockId: 'S1', name: '가나전자', return: 40 },
    { stockId: 'S2', name: '다라화학', return: -25 },
    { stockId: 'S3', name: '마바바이오', return: 12 },
    { stockId: 'S4', name: '사아모빌', return: -8 },
    { stockId: 'S5', name: '자차금융', return: 5 },
    { stockId: 'S6', name: '카타식품', return: 1.5 }, // minMove 미만
    { stockId: 'S7', name: '파하게임', return: 60 },
  ]

  it('R1 은 힌트 없음', () => {
    expect(deriveRoundHints({ round: 1, returns: RET })).toEqual([])
  })

  it('|등락률| 큰 순으로 S~D, 방향은 부호를 따른다', () => {
    const hints = deriveRoundHints({ round: 2, returns: RET })
    expect(hints.map((h) => [h.grade, h.related_stock_ids[0], h.impact])).toEqual([
      ['S', 'S7', 'up'], // +60
      ['A', 'S1', 'up'], // +40
      ['B', 'S2', 'down'], // -25
      ['C', 'S3', 'up'], // +12
      ['D', 'S4', 'down'], // -8
    ])
    for (const h of hints) {
      expect(h.round).toBe(2)
      expect(h.headline).toBeTruthy()
    }
  })

  it('minMove 미만 종목은 제외된다 (카타식품 +1.5%)', () => {
    const ids = deriveRoundHints({ round: 3, returns: RET }).flatMap((h) => h.related_stock_ids)
    expect(ids).not.toContain('S6')
  })

  it('큰 변동 종목이 등급 수보다 적으면 힌트도 적게 나온다', () => {
    const few = deriveRoundHints({
      round: 2,
      returns: [
        { stockId: 'A', return: 20 },
        { stockId: 'B', return: -15 },
        { stockId: 'C', return: 0.5 },
      ],
    })
    expect(few.map((h) => h.grade)).toEqual(['S', 'A'])
  })

  it('impact 가 항상 up/down 이고 related 종목이 실재 id 다', () => {
    const hints = deriveRoundHints({ round: 4, returns: RET })
    for (const h of hints) {
      expect(['up', 'down']).toContain(h.impact)
      expect(h.related_stock_ids).toHaveLength(1)
    }
  })
})
