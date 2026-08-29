'use strict'

// ============================================================
// stress_test.js — 5라운드 연속 시뮬레이션 캘리브레이션 점검 (Node 표준 기능만 사용)
// 실행: node stress_test.js
//
// verify.js가 "수식이 맞는가"를 검증한다면, 이 스크립트는 "실제 대회처럼 5라운드를
// 연속으로 돌렸을 때 가격이 바닥/천장에 붙지 않고 게임으로 쓸 만한가"를 점검한다.
//
// [v2] 매크로를 5라운드 내내 동일하게 고정하는 이전 방식(정체 시나리오)은 평균회귀 없는
// gravity_effect가 그대로 복리로 쌓여 비현실적인 폭주/붕괴를 만든다는 게 밝혀졌다
// (첫 스트레스 테스트 결과, docs 참고 불필요 — 대화 기록 참고). 실제 경기 사이클처럼
// 라운드마다 매크로가 움직이는 시나리오로 교체했다.
// ============================================================

const { generatePriceSeries } = require('./priceSim')

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
const START_PRICE = 10000
const TICK_SIZE = 50
const SEED = 20260822

const PRICE_MIN = 2000 // "현실적인 밴드" 하한
const PRICE_MAX = 150000 // "현실적인 밴드" 상한

const SCENARIOS = {
  cycle1_boomToLanding: {
    label: '1. 붐 → 연착륙 (Boom to Soft Landing)',
    macroByYear: {
      '2021': { unemp: 3.0, gdp: 5.5, int_r: 1.0, inf: 2.5, sent: 70, fx: 1280, oil: 70 }, // 테크 확장
      '2022': { unemp: 3.2, gdp: 4.0, int_r: 3.0, inf: 3.5, sent: 62, fx: 1320, oil: 80 }, // 완만한 금리 인상 시작
      '2023': { unemp: 3.8, gdp: 2.5, int_r: 4.5, inf: 4.0, sent: 52, fx: 1350, oil: 85 }, // 금리 인상 지속
      '2024': { unemp: 4.0, gdp: 1.5, int_r: 4.5, inf: 3.0, sent: 48, fx: 1330, oil: 78 }, // 고점 근처, 성장 둔화
      '2025': { unemp: 3.5, gdp: 2.5, int_r: 3.0, inf: 2.2, sent: 55, fx: 1300, oil: 75 }, // 정상화(연착륙)
    },
  },
  cycle2_stagflationRecovery: {
    label: '2. 스태그플레이션 충격 → 회복 (Stagflation Crisis to Recovery)',
    macroByYear: {
      '2021': { unemp: 6.0, gdp: -1.5, int_r: 5.5, inf: 8.5, sent: 28, fx: 1550, oil: 125 }, // 충격 발생(1년차)
      '2022': { unemp: 6.5, gdp: -2.0, int_r: 6.0, inf: 9.0, sent: 24, fx: 1600, oil: 130 }, // 충격 정점(2년차)
      '2023': { unemp: 5.5, gdp: 0.0, int_r: 5.0, inf: 6.5, sent: 32, fx: 1500, oil: 110 }, // 점진적 완화 시작
      '2024': { unemp: 4.5, gdp: 2.0, int_r: 3.5, inf: 4.0, sent: 45, fx: 1400, oil: 90 }, // 회복 지속
      '2025': { unemp: 3.5, gdp: 3.0, int_r: 2.5, inf: 2.5, sent: 55, fx: 1320, oil: 78 }, // 정상 수준 복귀
    },
  },
}

let passed = 0
let failed = 0
const failures = []
function check(name, cond, detail) {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    failures.push({ name, detail })
    console.log(`  ✗ ${name}`)
    if (detail) console.log(`    → ${detail}`)
  }
}

console.log('=== 5라운드 경기 사이클 스트레스 테스트 (v2) ===')
console.log(`(현실적 밴드: ${PRICE_MIN.toLocaleString()}원 ~ ${PRICE_MAX.toLocaleString()}원, seed=${SEED})\n`)

const allResults = {}

for (const [key, scenario] of Object.entries(SCENARIOS)) {
  console.log(`\n[${scenario.label}]`)
  const result = generatePriceSeries({
    stockIds: STOCK_IDS,
    years: YEARS,
    seed: SEED,
    startPrice: START_PRICE,
    tickSize: TICK_SIZE,
    macroByYear: scenario.macroByYear,
    betaFx: BETA_FX,
    betaOil: BETA_OIL,
    stepsPerYear: 252,
  })
  allResults[key] = result

  console.log('    종목별 라운드 궤적 (2021 → 2025):')
  for (const id of STOCK_IDS) {
    const row = YEARS.map((y) => result[id][y].toLocaleString()).join(' → ')
    console.log(`      ${id.padEnd(7)} ${row}`)
  }

  let outOfBand = 0
  let maxConsecutiveFloor = 0
  const total = STOCK_IDS.length * YEARS.length
  for (const id of STOCK_IDS) {
    let streak = 0
    for (const y of YEARS) {
      const v = result[id][y]
      if (v < PRICE_MIN || v > PRICE_MAX) outOfBand += 1
      if (v <= TICK_SIZE * 2) {
        streak += 1
        maxConsecutiveFloor = Math.max(maxConsecutiveFloor, streak)
      } else {
        streak = 0
      }
    }
  }

  check(
    `${scenario.label} — 전 종목·전 라운드가 현실적 밴드(${PRICE_MIN.toLocaleString()}~${PRICE_MAX.toLocaleString()}원) 안에 있음`,
    outOfBand === 0,
    `밴드 이탈 ${outOfBand}/${total}칸`,
  )
  check(
    `${scenario.label} — 어떤 종목도 3라운드 이상 연속으로 틱 바닥에 눌러붙지 않음`,
    maxConsecutiveFloor < 3,
    `최장 연속 바닥 라운드 수=${maxConsecutiveFloor}`,
  )
}

// ---------- 섹터 다이버전스 방향성 (충격이 실제로 있는 해에, 의도한 승자·패자가 나오는가) ----------
console.log('\n[섹터 다이버전스 방향성 — 충격 정점 연도(2022) 기준]')
const crisis = allResults.cycle2_stagflationRecovery
const boom = allResults.cycle1_boomToLanding

check(
  '사이클2 위기 정점(2022) — Energy(betaOil=+1.2)가 Air(betaOil=-1.1)보다 우세',
  crisis.Energy['2022'] > crisis.Air['2022'],
  `Energy=${crisis.Energy['2022']} Air=${crisis.Air['2022']}`,
)
check(
  '사이클1 붐 정점(2021) — Tech/Auto(betaFx 양수)가 Retail/Air(betaFx 음수)보다 우세',
  boom.Tech['2021'] > boom.Retail['2021'] && boom.Auto['2021'] > boom.Air['2021'],
  `Tech=${boom.Tech['2021']} Auto=${boom.Auto['2021']} Retail=${boom.Retail['2021']} Air=${boom.Air['2021']}`,
)
check(
  '사이클2 최종 회복(2025) — 위기 정점(2022) 대비 전 종목이 회복 방향으로 움직임(연쇄 붕괴 없음)',
  STOCK_IDS.every((id) => crisis[id]['2025'] > crisis[id]['2022']),
  STOCK_IDS.map((id) => `${id}:${crisis[id]['2022']}→${crisis[id]['2025']}`).join(', '),
)

// ---------- 결과 요약 ----------
console.log('\n=== 결과 요약 ===')
console.log(`통과: ${passed}  /  실패: ${failed}  /  총 ${passed + failed}건`)
if (failed > 0) {
  console.log('\n실패 목록:')
  for (const f of failures) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`)
  process.exitCode = 1
} else {
  process.exitCode = 0
}
