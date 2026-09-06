import { describe, it, expect, vi } from 'vitest'

// gameData.js는 supabase.js를 정적 import한다 — 실제 클라이언트 생성 없이 순수 함수만 검증한다.
vi.mock('./supabase', () => ({
  supabase: {},
  rpc: vi.fn(),
  select: vi.fn(),
}))

import { buildStocks, yearOf } from './gameData'

const game = (round) => ({
  current_round: round,
  round_year_map: { 1: 2020, 2: 2021, 3: 2022 },
})

describe('buildStocks — 관리자가 적용한 새 가격이 참가자 화면에 안전하게 반영된다', () => {
  it('정상 가격은 그대로 매핑된다', () => {
    const raw = [{ id: 'S01', name: '테스트전자', display_order: 1, prices: { 2021: 9_000, 2022: 10_000 } }]
    const [s] = buildStocks(raw, game(3), [])
    expect(s.price).toBe(10_000)
    expect(s.delta).toBe(1_000)
    expect(s.halted).toBe(false)
  })

  it('이번 연도 가격이 없으면(undefined) 거래정지로 처리하고 0으로 나누지 않는다', () => {
    const raw = [{ id: 'S01', name: '테스트전자', display_order: 1, prices: { 2021: 9_000 } }]
    const [s] = buildStocks(raw, game(3), [])
    expect(s.halted).toBe(true)
    expect(s.price).toBe(0)
    expect(Number.isFinite(s.chg)).toBe(true)
  })

  it('가격이 숫자로 파싱 안 되는 문자열이어도(NaN) 죽지 않고 거래정지로 처리한다', () => {
    const raw = [{ id: 'S01', name: '테스트전자', display_order: 1, prices: { 2022: 'not-a-number', 2021: 9_000 } }]
    const [s] = buildStocks(raw, game(3), [])
    expect(s.halted).toBe(true)
    expect(s.price).toBe(0)
    expect(Number.isFinite(s.chg)).toBe(true)
    expect(Number.isFinite(s.delta)).toBe(true)
  })

  it('prices 자체가 null이어도 죽지 않는다(잘못 저장된 시뮬레이터 결과 방어)', () => {
    const raw = [{ id: 'S01', name: '테스트전자', display_order: 1, prices: null }]
    const [s] = buildStocks(raw, game(3), [])
    expect(s.halted).toBe(true)
    expect(s.price).toBe(0)
  })

  it('직전 연도 가격이 없어도(신규상장) delta·chg가 NaN 없이 0으로 떨어진다', () => {
    const raw = [{ id: 'S01', name: '테스트전자', display_order: 1, prices: { 2022: 10_000 } }]
    const [s] = buildStocks(raw, game(3), [])
    expect(s.halted).toBe(false)
    expect(s.delta).toBe(0)
    expect(s.chg).toBe(0)
  })

  it('관리자가 시뮬레이터로 새 가격을 적용한 뒤(다음 라운드 값 추가) 재계산해도 안전하다', () => {
    const before = [{ id: 'S01', name: '테스트전자', display_order: 1, prices: { 2021: 9_000, 2022: 10_000 } }]
    // admin_apply_simulated_prices가 하는 일과 동일 — prices 객체를 교체
    const after = [
      { id: 'S01', name: '테스트전자', display_order: 1, prices: { 2021: 9_000, 2022: 10_000, 2023: 11_500 } },
    ]
    const s1 = buildStocks(before, game(3), [])[0]
    const s2 = buildStocks(after, { ...game(3), current_round: 4, round_year_map: { ...game(3).round_year_map, 4: 2023 } }, [])[0]
    expect(s1.price).toBe(10_000)
    expect(s2.price).toBe(11_500)
    expect(s2.delta).toBe(1_500)
  })
})

describe('yearOf', () => {
  it('라운드 → 연도 매핑', () => {
    expect(yearOf(game(3))).toBe(2022)
  })

  it('라운드 정보가 없으면 null', () => {
    expect(yearOf({})).toBe(null)
  })
})
