import { describe, it, expect } from 'vitest'
import { distribute, sortPool } from './distribute'

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
