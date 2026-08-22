'use strict'

// ============================================================
// verify.js — priceSim.js(7요인) 검증 스크립트 (Node.js 표준 기능만 사용)
// 실행: node verify.js
// ============================================================

const assert = require('node:assert/strict')
const { generatePriceSeries, buildCorrelationMatrix, choleskyDecompose, PRNG } = require('./priceSim')

let passed = 0
let failed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed += 1
    failures.push({ name, err })
    console.log(`  ✗ ${name}`)
    console.log(`    → ${err.message}`)
  }
}

console.log('=== priceSim.js (7요인) 검증 시작 ===\n')

// ---------- 공통 픽스처: add_new_sim.py와 동일한 5개 대표 섹터 ----------
const SECTOR_STOCKS = [
  { id: 'Tech', betaFx: 0.8, betaOil: -0.2 },
  { id: 'Energy', betaFx: -0.1, betaOil: 1.2 },
  { id: 'Air', betaFx: -0.9, betaOil: -1.1 },
  { id: 'Auto', betaFx: 0.7, betaOil: -0.4 },
  { id: 'Retail', betaFx: -0.5, betaOil: -0.3 },
]
const STOCK_IDS = SECTOR_STOCKS.map((s) => s.id)
const BETA_FX = SECTOR_STOCKS.map((s) => s.betaFx)
const BETA_OIL = SECTOR_STOCKS.map((s) => s.betaOil)

const YEARS = ['2021', '2022', '2023', '2024', '2025']
const MACRO_BY_YEAR = {
  '2021': { unemp: 3.2, gdp: 4.0, int_r: 1.0, inf: 2.5, sent: 55, fx: 1280, oil: 70 },
  '2022': { unemp: 3.5, gdp: 2.5, int_r: 2.5, inf: 5.0, sent: 48, fx: 1350, oil: 95 }, // 금리 인상 국면
  '2023': { unemp: 6.2, gdp: -1.0, int_r: 4.5, inf: 8.5, sent: 30, fx: 1450, oil: 110 }, // 위기(임계 초과)
  '2024': { unemp: 4.0, gdp: 1.5, int_r: 3.0, inf: 4.0, sent: 45, fx: 1380, oil: 85 },
  '2025': { unemp: 3.0, gdp: 3.2, int_r: 2.0, inf: 2.2, sent: 58, fx: 1300, oil: 75 },
}

function baseConfig(overrides = {}) {
  return {
    stockIds: STOCK_IDS,
    years: YEARS,
    seed: 20260822,
    macroByYear: MACRO_BY_YEAR,
    betaFx: BETA_FX,
    betaOil: BETA_OIL,
    stepsPerYear: 252,
    ...overrides,
  }
}

// ============================================================
// (a) 결정성 (Determinism)
// ============================================================
console.log('[a] 결정성 검증 (동일 시드 → 동일 결과)')

test('같은 시드 + 같은 파라미터 → 완전히 동일한 결과', () => {
  const out1 = generatePriceSeries(baseConfig())
  const out2 = generatePriceSeries(baseConfig())
  assert.deepStrictEqual(out1, out2)
})

test('다른 시드 → 다른 결과', () => {
  const out1 = generatePriceSeries(baseConfig({ seed: 1 }))
  const out2 = generatePriceSeries(baseConfig({ seed: 2 }))
  assert.notDeepStrictEqual(out1, out2)
})

test('PRNG 클래스 자체도 시드 결정적', () => {
  const a = new PRNG(42)
  const b = new PRNG(42)
  const seqA = Array.from({ length: 5 }, () => a.uniform())
  const seqB = Array.from({ length: 5 }, () => b.uniform())
  assert.deepStrictEqual(seqA, seqB)
})

// ============================================================
// (b) 경계값 검증 (NaN 없음 / 정수 / 음수 아님)
// ============================================================
console.log('\n[b] 경계값 검증 (NaN 없음 / 정수 / 음수 아님)')

const boundaryOut = generatePriceSeries(baseConfig())

test('모든 가격이 유한한 정수', () => {
  for (const id of STOCK_IDS) {
    for (const y of YEARS) {
      const v = boundaryOut[id][y]
      assert.ok(Number.isFinite(v), `${id}/${y} = ${v} (finite 아님)`)
      assert.ok(Number.isInteger(v), `${id}/${y} = ${v} (정수 아님)`)
    }
  }
})

test('모든 가격이 1 이상 (음수·0 없음)', () => {
  for (const id of STOCK_IDS) {
    for (const y of YEARS) {
      assert.ok(boundaryOut[id][y] >= 1, `${id}/${y} = ${boundaryOut[id][y]}`)
    }
  }
})

test('7요인 전부 극단값(실업15·물가20·GDP-5·금리10·FX1800·유가160)에서도 NaN 미발생', () => {
  const extremeMacro = { unemp: 15, gdp: -5, int_r: 10, inf: 20, sent: 0, fx: 1800, oil: 160 }
  const extreme = generatePriceSeries(
    baseConfig({
      seed: 7,
      macroByYear: Object.fromEntries(YEARS.map((y) => [y, extremeMacro])),
      jump: { lambda: 20, mu: -0.3, sigma: 0.5 },
      garch: { omega: 0.0005, alpha: 0.3, beta: 0.68 },
      stepsPerYear: 60,
    }),
  )
  for (const id of STOCK_IDS) {
    for (const y of YEARS) {
      assert.ok(Number.isFinite(extreme[id][y]))
    }
  }
})

test('위기 임계치(실업 5%·물가 8% 초과) 변동성 배율 로직이 NaN을 만들지 않음', () => {
  const out = generatePriceSeries(
    baseConfig({ years: ['2023'], macroByYear: { '2023': MACRO_BY_YEAR['2023'] } }),
  )
  for (const id of STOCK_IDS) assert.ok(Number.isFinite(out[id]['2023']))
})

// ============================================================
// (c) WTS `stocks.prices` jsonb 스키마 호환성
// ============================================================
console.log('\n[c] WTS `stocks.prices` jsonb 스키마 호환성')

test('최상위 키 = stockIds 전체와 정확히 일치', () => {
  assert.deepStrictEqual(Object.keys(boundaryOut).sort(), [...STOCK_IDS].sort())
})

test('각 종목의 하위 키 = years 전체와 정확히 일치(문자열)', () => {
  for (const id of STOCK_IDS) {
    assert.deepStrictEqual(Object.keys(boundaryOut[id]).sort(), [...YEARS].sort())
  }
})

test('값 타입이 number (JSON 직렬화/역직렬화 후에도 number 유지)', () => {
  const roundTrip = JSON.parse(JSON.stringify(boundaryOut))
  for (const id of STOCK_IDS) {
    for (const y of YEARS) {
      assert.strictEqual(typeof roundTrip[id][y], 'number')
    }
  }
})

test('admin_upsert_stock의 p_prices 인자로 그대로 쓸 수 있는 형태(종목별 prices 서브객체 추출)', () => {
  const single = boundaryOut[STOCK_IDS[0]]
  assert.deepStrictEqual(Object.keys(single).sort(), [...YEARS].sort())
})

// ============================================================
// (d) 임의 라운드 수 / 종목 리스트 동적 처리 (하드코딩 상수 없음)
// ============================================================
console.log('\n[d] 임의 라운드 수 · 종목 리스트 동적 처리')

test('종목 1개 · 라운드 1개 (최소 케이스, betaFx/betaOil 미지정 → 기본 0)', () => {
  const out = generatePriceSeries({ stockIds: ['ONLY'], years: ['2030'], seed: 5, stepsPerYear: 10 })
  assert.deepStrictEqual(Object.keys(out), ['ONLY'])
  assert.deepStrictEqual(Object.keys(out.ONLY), ['2030'])
})

test('종목 12개 · 라운드 8개 (가변 크기)', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `X${i}`)
  const yrs = Array.from({ length: 8 }, (_, i) => String(2020 + i))
  const out = generatePriceSeries({ stockIds: ids, years: yrs, seed: 99, stepsPerYear: 20 })
  assert.strictEqual(Object.keys(out).length, 12)
  ids.forEach((id) => assert.strictEqual(Object.keys(out[id]).length, 8))
})

test('종목/라운드 개수를 바꿔도 코드 수정 없이 동일 함수로 동작', () => {
  for (const n of [2, 5, 9]) {
    const ids = Array.from({ length: n }, (_, i) => `N${n}_${i}`)
    const out = generatePriceSeries({ stockIds: ids, years: ['2099'], seed: 3, stepsPerYear: 5 })
    assert.strictEqual(Object.keys(out).length, n)
  }
})

test('betaFx/betaOil 길이가 stockIds와 다르면 명시적으로 에러', () => {
  assert.throws(() =>
    generatePriceSeries({ stockIds: ['A', 'B'], years: ['2021'], seed: 1, betaFx: [0.5], stepsPerYear: 5 }),
  )
})

test('stockIds 또는 years가 비어있으면 명시적으로 에러(무음 실패 금지)', () => {
  assert.throws(() => generatePriceSeries({ stockIds: [], years: ['2021'], seed: 1 }))
  assert.throws(() => generatePriceSeries({ stockIds: ['A'], years: [], seed: 1 }))
})

// ============================================================
// (e) 섹터 다이버전스 — 환율·유가 충격이 섹터별로 다른 움직임을 만드는가
// ============================================================
console.log('\n[e] 섹터 다이버전스 (환율·유가 충격 → 종목별 상이한 움직임)')

test('환율 급등(1300→1750) 시나리오 — 섹터별 수익률이 유의미하게 갈린다', () => {
  const out = generatePriceSeries(
    baseConfig({
      years: ['2021'],
      macroByYear: { '2021': { ...MACRO_BY_YEAR['2021'], fx: 1750 } },
      stepsPerYear: 150,
    }),
  )
  const ratios = STOCK_IDS.map((id) => out[id]['2021'] / 10000)
  const spread = Math.max(...ratios) - Math.min(...ratios)
  console.log('    [참고] 환율 1750원 충격 — betaFx 내림차순 정렬:')
  SECTOR_STOCKS.map((s, i) => ({ ...s, ratio: ratios[i] }))
    .sort((a, b) => b.betaFx - a.betaFx)
    .forEach((s) => console.log(`      ${s.id.padEnd(7)} betaFx=${s.betaFx.toFixed(1).padStart(5)}  수익배율=${s.ratio.toFixed(3)}`))
  assert.ok(spread > 0.03, `섹터간 수익률 분산이 너무 작음(spread=${spread.toFixed(4)})`)
})

test('유가 급등(75→150) 시나리오 — 섹터별 수익률이 유의미하게 갈린다', () => {
  const out = generatePriceSeries(
    baseConfig({
      years: ['2021'],
      macroByYear: { '2021': { ...MACRO_BY_YEAR['2021'], oil: 150 } },
      stepsPerYear: 150,
    }),
  )
  const ratios = STOCK_IDS.map((id) => out[id]['2021'] / 10000)
  const spread = Math.max(...ratios) - Math.min(...ratios)
  console.log('    [참고] 유가 150달러 충격 — betaOil 내림차순 정렬:')
  SECTOR_STOCKS.map((s, i) => ({ ...s, ratio: ratios[i] }))
    .sort((a, b) => b.betaOil - a.betaOil)
    .forEach((s) => console.log(`      ${s.id.padEnd(7)} betaOil=${s.betaOil.toFixed(1).padStart(5)}  수익배율=${s.ratio.toFixed(3)}`))
  assert.ok(spread > 0.03, `섹터간 수익률 분산이 너무 작음(spread=${spread.toFixed(4)})`)
})

// ============================================================
// [보너스] Cholesky 재구성 검증
// ============================================================
console.log('\n[보너스] 상관행렬 Cholesky 재구성 검증')

test('상관행렬 Cholesky 분해가 L·Lᵀ = A를 재현', () => {
  const A = buildCorrelationMatrix(5, 0.4)
  const L = choleskyDecompose(A)
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      let sum = 0
      for (let k = 0; k < 5; k++) sum += L[i][k] * L[j][k]
      assert.ok(Math.abs(sum - A[i][j]) < 1e-9, `[${i}][${j}] 재구성 오차 = ${Math.abs(sum - A[i][j])}`)
    }
  }
})

// ============================================================
// 결과 요약
// ============================================================
console.log('\n=== 결과 요약 ===')
console.log(`통과: ${passed}  /  실패: ${failed}  /  총 ${passed + failed}건`)

if (failed > 0) {
  console.log('\n실패 목록:')
  for (const f of failures) console.log(`  - ${f.name}: ${f.err.message}`)
  process.exitCode = 1
} else {
  console.log('\n샘플 출력 (Tech, 종목 1개 전체 연도):')
  console.log(JSON.stringify({ Tech: boundaryOut.Tech }, null, 2))
  process.exitCode = 0
}
