import { describe, it, expect } from 'vitest'
import {
  stocks,
  initialHints,
  NEWS_SENTINELS,
  ROUNDS,
  FINAL_YEAR,
  FIN_YEARS,
  FIN_INPUTS,
  deriveFinancials,
  financials,
  PRINCIPAL,
  initialCash,
  initialHistory,
  MACRO,
  MACRO_METRICS,
} from './data'

// 데이터 정합성. 손으로 전수 대조하던 것을 테스트로 고정한다.
// 여기가 깨지면 교육 시나리오(힌트가 실제 등락과 일치)가 어긋난 것이다.

const codes = stocks.map((s) => s.code)
const known = new Set([...codes, ...NEWS_SENTINELS])
const byCode = Object.fromEntries(stocks.map((s) => [s.code, s]))
const yearOfRound = (r) => ROUNDS.find((x) => x.round === r)?.year
// round 힌트가 예고하는 '다음 해'. 마지막 라운드는 대회 종료 시 공개되는 FINAL_YEAR.
const nextYearOf = (round) => {
  const nr = ROUNDS.find((r) => r.round === round + 1)
  if (nr) return nr.year
  return round === ROUNDS[ROUNDS.length - 1].round ? FINAL_YEAR : undefined
}

describe('종목', () => {
  it('종목코드가 중복되지 않는다', () => {
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('종목명이 중복되지 않는다', () => {
    const names = stocks.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('모든 종목에 한 줄 소개가 있다', () => {
    for (const s of stocks) expect(s.desc, s.name).toBeTruthy()
  })

  it('모든 라운드·최종 연도의 주가가 0 이상 정수다 (0 = 거래정지/미상장)', () => {
    for (const s of stocks) {
      for (const y of FIN_YEARS) {
        const p = s.priceByYear[y]
        expect(Number.isInteger(p), `${s.name} ${y}`).toBe(true)
        expect(p, `${s.name} ${y}`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('상장 라운드(listedFromRound) 그 해엔 가격이 0보다 크다', () => {
    for (const s of stocks) {
      const y = yearOfRound(s.listedFromRound)
      expect(s.priceByYear[y], `${s.name} 상장연도 ${y}`).toBeGreaterThan(0)
    }
  })
})

describe('힌트', () => {
  it('R1에는 힌트가 없다', () => {
    expect(initialHints.filter((h) => h.round === 1)).toEqual([])
  })

  it('등급은 S/A/B/C/D 중 하나다', () => {
    for (const h of initialHints) expect(['S', 'A', 'B', 'C', 'D'], h.headline).toContain(h.grade)
  })

  it('impact가 up/down/flat 중 하나다', () => {
    for (const h of initialHints) expect(['up', 'down', 'flat'], h.headline).toContain(h.impact)
  })

  it('모든 관련 종목이 실존한다 (오타·삭제된 종목 없음)', () => {
    const bad = initialHints.flatMap((h) =>
      h.related.filter((c) => !known.has(c)).map((c) => `${h.grade}R${h.round}: "${c}"`),
    )
    expect(bad).toEqual([])
  })

  it('실제 존재하는 라운드에만 붙어 있다', () => {
    const valid = new Set(ROUNDS.map((r) => r.round))
    for (const h of initialHints) expect(valid.has(h.round), h.headline).toBe(true)
  })

  // 이게 이 프로젝트의 교육 계약이다:
  // 힌트가 호재라 하면 그 해→다음 해에 오르고, 악재라 하면 떨어져야 한다.
  // 마지막 라운드(R5) 힌트는 대회 종료 시 공개되는 FINAL_YEAR 등락으로 검증한다.
  it('호재·악재 태그가 다음 해 실제 등락 방향과 일치한다', () => {
    const mismatches = []
    for (const h of initialHints) {
      if (h.impact === 'flat') continue // 중립은 방향을 약속하지 않는다
      const y = yearOfRound(h.round)
      const ny = nextYearOf(h.round)
      if (ny == null) continue
      for (const code of h.related) {
        const s = byCode[code]
        if (!s) continue
        const a = s.priceByYear[y]
        const b = s.priceByYear[ny]
        if (!a || b == null) continue // 미상장·거래정지 구간(현재가 0이면 등락률 정의 불가)
        const move = ((b - a) / a) * 100
        const ok = h.impact === 'up' ? move > 3 : move < -3
        if (!ok) mismatches.push(`${h.grade}R${h.round} ${code}: ${h.impact} 인데 ${move.toFixed(1)}%`)
      }
    }
    expect(mismatches).toEqual([])
  })
})

describe('재무제표', () => {
  it('모든 종목에 재무 자료가 있다', () => {
    for (const s of stocks) expect(financials[s.code], s.name).toBeDefined()
  })

  it('연도별로 null(미상장/폐지)이거나 입력 잎 7개가 빠짐없이 숫자다', () => {
    for (const s of stocks) {
      for (const y of FIN_YEARS) {
        expect(financials[s.code], `${s.name}`).toHaveProperty(String(y))
        const row = financials[s.code][y]
        if (row === null) continue // 미상장/폐지 연도
        for (const m of FIN_INPUTS) {
          expect(typeof row[m.key], `${s.name} ${y} ${m.key}`).toBe('number')
        }
      }
    }
  })

  it('자산·부채·비용 입력은 음수가 될 수 없다', () => {
    const nonNeg = ['currentAssets', 'noncurrentAssets', 'currentLiabilities', 'noncurrentLiabilities', 'operatingExpense', 'nonoperatingExpense']
    for (const s of stocks) {
      for (const y of FIN_YEARS) {
        const row = financials[s.code][y]
        if (row === null) continue
        for (const k of nonNeg) expect(row[k], `${s.name} ${y} ${k}`).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('deriveFinancials (자동 계산)', () => {
  it('목업 예시대로 계산한다 (자산=부채+자본, 단계 차감, 비율)', () => {
    const f = deriveFinancials({
      currentAssets: 60, noncurrentAssets: 40,
      currentLiabilities: 20, noncurrentLiabilities: 50,
      revenue: 1000, operatingExpense: 600, nonoperatingExpense: 100,
    })
    expect(f.assets).toBe(100)
    expect(f.liabilities).toBe(70)
    expect(f.equity).toBe(30)
    expect(f.assets).toBe(f.liabilities + f.equity) // 회계 항등식
    expect(f.operatingIncome).toBe(400)
    expect(f.netIncome).toBe(300)
    expect(f.debtRatio).toBeCloseTo(233.3, 1)
    expect(f.roe).toBeCloseTo(1000, 1)
    expect(f.impaired).toBe(false)
  })

  it('자본잠식(자본 ≤ 0)이면 부채비율·ROE는 null이고 impaired', () => {
    const f = deriveFinancials({
      currentAssets: 10, noncurrentAssets: 10,
      currentLiabilities: 30, noncurrentLiabilities: 20,
      revenue: 100, operatingExpense: 120, nonoperatingExpense: 0,
    })
    expect(f.equity).toBe(-30)
    expect(f.impaired).toBe(true)
    expect(f.debtRatio).toBeNull()
    expect(f.roe).toBeNull()
    expect(f.operatingIncome).toBe(-20) // 영업손실도 계산은 된다
  })

  it('null 입력이면 null', () => {
    expect(deriveFinancials(null)).toBeNull()
  })
})

describe('라운드', () => {
  it('1부터 1씩 증가한다', () => {
    ROUNDS.forEach((r, i) => expect(r.round).toBe(i + 1))
  })

  it('연도도 1씩 증가한다', () => {
    for (let i = 1; i < ROUNDS.length; i++) {
      expect(ROUNDS[i].year).toBe(ROUNDS[i - 1].year + 1)
    }
  })

  it('모든 라운드 연도 + 최종 연도의 재무제표 열이 있다', () => {
    for (const r of ROUNDS) expect(FIN_YEARS).toContain(r.year)
    expect(FIN_YEARS).toContain(FINAL_YEAR)
  })

  it('최종 연도는 마지막 라운드 다음 해다', () => {
    expect(FINAL_YEAR).toBe(ROUNDS[ROUNDS.length - 1].year + 1)
  })
})

describe('시작 상태', () => {
  it('거래 전이므로 예수금이 원금 전액이다', () => {
    expect(initialCash).toBe(PRINCIPAL)
  })

  it('체결내역이 비어 있다', () => {
    expect(initialHistory).toEqual([])
  })
})

describe('시황(거시경제)', () => {
  it('모든 라운드 연도 + 최종 연도의 시황 자료가 있다', () => {
    for (const y of FIN_YEARS) expect(MACRO[y], `${y}년 시황`).toBeTruthy()
  })

  it('각 연도에 6개 지표가 빠짐없이 숫자다', () => {
    for (const y of FIN_YEARS) {
      for (const m of MACRO_METRICS) {
        expect(typeof MACRO[y]?.[m.key], `${y}년 ${m.key}`).toBe('number')
      }
    }
  })

  it('금리는 음수가 아니고 지수·유가·금은 양수다', () => {
    for (const y of FIN_YEARS) {
      expect(MACRO[y].rate).toBeGreaterThanOrEqual(0)
      for (const k of ['kospi', 'sp500', 'nikkei', 'europe', 'oil', 'gold']) {
        expect(MACRO[y][k], `${y}년 ${k}`).toBeGreaterThan(0)
      }
    }
  })
})
