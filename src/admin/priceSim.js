// priceSim.js — 순수 JS 확률과정 다자산 주가 시뮬레이션 엔진 (외부 npm 의존성 0)
//
// sim_sandbox/priceSim.js에서 검증을 마치고 이식했다(../../sim_sandbox/verify.js,
// stress_test.js 참고 — 이 리포에는 없음, 검증 이력은 개발 대화 기록 참고):
//   - 기하학적 브라운 운동(GBM)
//   - GARCH(1,1) 조건부 변동성
//   - Merton 점프-확산(Jump-Diffusion, 블랙스완)
//   - 7대 거시요인(금리·실업률·물가·GDP·소비심리·환율·유가) Shock(Δ)/Gravity(절대치) 하이브리드 드리프트
//   - 환율·유가는 종목별 섹터 베타(betaFx/betaOil)로만 스케일되고, compMultipliers(공통 요인 전용
//     랜덤 계수)는 곱하지 않는다 — 섹터 신호가 랜덤 계수에 희석되지 않게 분리했다.
//   - Cholesky 분해 기반 종목 간 상관관계
//   - KRX 스타일 동적 호가단위(가격 구간별 틱) — 고정 틱은 저가 종목을 영구 정체시킨다.
//
// 관리자(Admin) 전용 모듈이다 — 학생 화면(App.jsx) 어디에서도 import하지 않는다.
// 계산은 이 파일이 전부 하고, DB 반영은 admin_apply_simulated_prices RPC(원자적 다건 갱신)만 한다.
//
// [설계 결정] PRNG는 numpy(PCG64)와 비트 단위로 일치시키지 않는다. "같은 시드 → 같은 결과"
// 라는 자체 결정성만 보장한다.

// ---------- 1. 시드 가능한 PRNG (Mulberry32 기반, 클래스형 API) ----------
export class PRNG {
  constructor(seed) {
    this._state = seed >>> 0
  }

  /** [0,1) 균등분포. */
  uniform() {
    this._state |= 0
    this._state = (this._state + 0x6d2b79f5) | 0
    let t = Math.imul(this._state ^ (this._state >>> 15), 1 | this._state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** 표준정규분포 (Box-Muller). */
  normal() {
    let u1
    do {
      u1 = this.uniform()
    } while (u1 <= Number.EPSILON)
    const u2 = this.uniform()
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  }

  /** 포아송분포 (Knuth 알고리즘). */
  poisson(lambda) {
    if (lambda <= 0) return 0
    const L = Math.exp(-lambda)
    let k = 0
    let p = 1
    do {
      k += 1
      p *= this.uniform()
    } while (p > L)
    return k - 1
  }
}

// ---------- 2. 상관행렬 + Cholesky 분해 ----------
export function buildCorrelationMatrix(n, rho = 0.4) {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1.0 : rho)))
}

export function choleskyDecompose(A) {
  const n = A.length
  const L = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0
      for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k]
      if (i === j) {
        L[i][j] = Math.sqrt(Math.max(A[i][i] - sum, 0))
      } else {
        L[i][j] = L[j][j] !== 0 ? (A[i][j] - sum) / L[j][j] : 0
      }
    }
  }
  return L
}

function matVecMul(L, z) {
  return L.map((row) => row.reduce((sum, v, k) => sum + v * z[k], 0))
}

function clip(x, lo, hi) {
  return Math.min(Math.max(x, lo), hi)
}

// ---------- 3. 7대 거시요인 기본값 ----------
const MACRO_BASE = { unemp: 3.0, gdp: 3.0, int_r: 2.0, inf: 2.0, sent: 50.0, fx: 1300.0, oil: 75.0 }

export function defaultMacro() {
  return { ...MACRO_BASE }
}

// 5라운드 스트레스 테스트에서 "보통 수준의 경기 변동"(예: 기준금리 2.0%→4.5%)조차 즉시
// 클램프 상한/하한에 붙어버리는 게 확인돼 원본 가중치를 0.5배로 재교정했다
// (연간 ±15~35% 정도의 "있을 법한" 변동폭을 목표로 함).
// unemp/gdp/int_r/inf/sent = "공통" 항(comp_multipliers로 종목별 랜덤 스케일),
// fx/oil = "섹터" 항(종목별 betaFx/betaOil로만 스케일, comp_multipliers 미적용).
export function defaultWeights() {
  return {
    shock: { unemp: -0.1, gdp: 0.25, int_r: -0.2, inf: -0.15, sent: 0.1, fx: 0.15, oil: 0.15 },
    gravity: { unemp: -0.15, gdp: 0.25, int_r: -0.2, inf: -0.15, sent: 0.1, fx: 0.1, oil: 0.1 },
  }
}

// ---------- KRX 스타일 동적 호가 단위 ----------
// 고정 틱사이즈는 가격 수준과 무관한 절대값이라, 저가 종목이 바닥 근처로 떨어지면
// 다음 틱까지 가는 데 필요한 "퍼센트" 변동폭이 비정상적으로 커져(50원→100원 = +100%)
// 사실상 영구 정체에 빠진다. 실제 한국거래소 호가단위처럼 가격 구간별로 틱을 다르게 둬서,
// 저가 구간일수록 틱이 촘촘해지게 한다.
export function getKRXRoundPrice(price) {
  let tick = 1
  if (price >= 500000) tick = 1000
  else if (price >= 100000) tick = 500
  else if (price >= 50000) tick = 100
  else if (price >= 10000) tick = 50
  else if (price >= 5000) tick = 10
  else if (price >= 1000) tick = 5
  else tick = 1

  return Math.max(Math.round(price / tick) * tick, 100) // 절대 하한 100원
}

// ---------- 4. 다자산 확률과정 엔진 ----------
export class MarketSim {
  constructor({
    seed,
    startPrice = 10000,
    startPrices, // 종목별 시작가 배열(길이=nCompanies). 지정하면 startPrice(단일값)보다 우선한다 —
    // "다음 라운드만" 모드에서 실제 현재가를 그대로 이어받아 시작하기 위함.
    nCompanies,
    correlation = 0.4,
    compMultiplierRange = [0.5, 1.5],
    betaFx,
    betaOil,
  }) {
    if (!Number.isInteger(nCompanies) || nCompanies < 1) {
      throw new Error('nCompanies는 1 이상의 정수여야 합니다')
    }
    if (startPrices && startPrices.length !== nCompanies) {
      throw new Error('startPrices 길이는 nCompanies와 같아야 합니다')
    }
    this.n = nCompanies
    this.prng = new PRNG(seed >>> 0)
    this.price = startPrices ? startPrices.slice() : new Array(nCompanies).fill(startPrice)
    this.prevRet = new Array(nCompanies).fill(0)
    this.currentVar = null // GARCH 장기평균분산 — 첫 step에서 지연 초기화
    this.L = choleskyDecompose(buildCorrelationMatrix(nCompanies, correlation))
    const [lo, hi] = compMultiplierRange
    this.compMultipliers = Array.from({ length: nCompanies }, () => lo + this.prng.uniform() * (hi - lo))
    // 섹터 베타 미지정 시 0(중립) — 종목 수를 하드코딩하지 않기 위해 길이는 nCompanies로 맞춘다.
    this.betaFx = betaFx ?? new Array(nCompanies).fill(0)
    this.betaOil = betaOil ?? new Array(nCompanies).fill(0)
    if (this.betaFx.length !== nCompanies || this.betaOil.length !== nCompanies) {
      throw new Error('betaFx/betaOil 길이는 nCompanies와 같아야 합니다')
    }
    this.prevMacro = defaultMacro()
  }

  /** 하루(1스텝) 전진. macro는 그 스텝의 7대 거시지표, params는 엔진 파라미터. */
  step(macro, params) {
    const { baseMu, weights = defaultWeights(), garch, thresholds, jump } = params
    const dt = 1 / 252

    if (this.currentVar === null) {
      const { omega, alpha, beta } = garch
      const calcBeta = alpha + beta >= 1.0 ? 0.99 - alpha : beta
      this.currentVar = new Array(this.n).fill(omega / (1.0 - alpha - calcBeta))
    }

    // Δ(변화량, Shock) + 절대치(구조적 압박, Gravity) — 7개 지표 전부
    const d = {
      unemp: macro.unemp - this.prevMacro.unemp,
      gdp: macro.gdp - this.prevMacro.gdp,
      int_r: macro.int_r - this.prevMacro.int_r,
      inf: macro.inf - this.prevMacro.inf,
      sent: (macro.sent - this.prevMacro.sent) / 10.0,
      fx: (macro.fx - this.prevMacro.fx) / 100.0,
      oil: (macro.oil - this.prevMacro.oil) / 10.0,
    }
    const g = {
      unemp: macro.unemp - MACRO_BASE.unemp,
      gdp: macro.gdp - MACRO_BASE.gdp,
      int_r: macro.int_r - MACRO_BASE.int_r,
      inf: macro.inf - MACRO_BASE.inf,
      sent: (macro.sent - MACRO_BASE.sent) / 10.0,
      fx: (macro.fx - MACRO_BASE.fx) / 100.0,
      oil: (macro.oil - MACRO_BASE.oil) / 10.0,
    }

    const ws = weights.shock
    const wg = weights.gravity

    // 공통 거시 드리프트(5요인만 — fx/oil은 여기 포함하지 않는다)
    // [중력 감쇠] gravity_effect(구조적 압박)는 평균회귀가 없어 같은 매크로가 여러 라운드
    // 그대로 유지되면 매일 같은 방향으로 계속 쌓인다 — 5라운드(1260일) 누적하면 드리프트
    // 클램프만으로는 못 막을 만큼 복리로 불어난다는 게 스트레스 테스트로 확인됐다.
    // shock_effect(하루짜리 변화량 충격)는 감쇠하지 않는다 — 뉴스성 단발 충격은 그대로 둔다.
    const gravityDampener = 0.7
    const shockEffect = ws.unemp * d.unemp + ws.gdp * d.gdp + ws.int_r * d.int_r + ws.inf * d.inf + ws.sent * d.sent
    const gravityEffect =
      (wg.unemp * g.unemp + wg.gdp * g.gdp + wg.int_r * g.int_r + wg.inf * g.inf + wg.sent * g.sent) *
      gravityDampener
    const commonDrift = shockEffect + gravityEffect

    // 섹터 고유 충격(환율·유가) — 종목별 beta로만 스케일 (스칼라 항, 종목별 곱은 아래서)
    const fxTerm = ws.fx * d.fx + wg.fx * g.fx
    const oilTerm = ws.oil * d.oil + wg.oil * g.oil

    // comp_multipliers는 공통 항에만 적용해 섹터 베타 신호를 보존한다.
    // 드리프트 클램프: current_sigma를 min(...,2.0)으로 클램프하는 것과 동일한 패턴으로,
    // 연간 기대수익률에도 "구조적으로 있을 법한" 상한/하한을 둔다 — 연 -60% ~ +60%.
    const MIN_DRIFT = -0.6
    const MAX_DRIFT = 0.6
    const dynamicMu = this.compMultipliers.map((m, i) => {
      const mu = (baseMu + commonDrift) * m + this.betaFx[i] * fxTerm + this.betaOil[i] * oilTerm
      return clip(mu, MIN_DRIFT, MAX_DRIFT)
    })

    // GARCH(1,1) 변동성
    let { omega, alpha, beta } = garch
    if (alpha + beta >= 1.0) beta = 0.99 - alpha
    this.currentVar = this.currentVar.map((v, i) => omega + alpha * this.prevRet[i] ** 2 + beta * v)
    let currentSigma = this.currentVar.map((v) => Math.min(Math.sqrt(v * 252), 2.0))

    // 위기 임계치 초과 시 변동성 배율. ×2.0(상한 3.0=연 300%)은 GBM의 -0.5σ² 항 때문에
    // 드리프트 클램프와 무관하게 가격을 짓눌러 위기 시나리오가 1라운드 만에 바닥권으로
    // 무너지는 원인이었다 — ×1.3(상한 1.2=연 120%)로 완화했다.
    if (macro.unemp > thresholds.unemp || macro.inf > thresholds.inf) {
      currentSigma = currentSigma.map((s) => Math.min(s * 1.3, 1.2))
    }

    // 머튼 점프 보상항(기댓값 보존)
    const { lambda: lambdaJump, mu: muJump, sigma: sigmaJump } = jump
    const jumpCompensator = lambdaJump * (Math.exp(muJump + 0.5 * sigmaJump ** 2) - 1.0)

    // GBM 연속항 — Cholesky로 상관된 정규난수
    const z = Array.from({ length: this.n }, () => this.prng.normal())
    const W = matVecMul(this.L, z)
    const drift = dynamicMu.map((mu, i) => (mu - 0.5 * currentSigma[i] ** 2 - jumpCompensator) * dt)
    const shock = currentSigma.map((s, i) => s * W[i] * Math.sqrt(dt))

    // Merton 점프-확산 — 점프가 없으면(numJumps===0) 정규난수를 소비하지 않는다.
    const jumpImpact = Array.from({ length: this.n }, () => {
      const numJumps = this.prng.poisson(lambdaJump * dt)
      if (numJumps <= 0) return 0
      return muJump * numJumps + sigmaJump * Math.sqrt(numJumps) * this.prng.normal()
    })

    // 최종 주가 — KRX 스타일 동적 호가단위로 반올림(가격 구간별 틱 + 절대 하한 100원)
    const rawPrices = this.price.map((p, i) => p * Math.exp(drift[i] + shock[i] + jumpImpact[i]))
    const newPrices = rawPrices.map((p) => getKRXRoundPrice(p))

    this.prevRet = newPrices.map((p, i) => clip(Math.log(Math.max(p / this.price[i], 0.0001)), -0.5, 0.5))
    this.price = newPrices
    this.prevMacro = { ...macro }
    return this.price.slice()
  }
}

// ---------- 5. WTS `stocks.prices` jsonb 스키마로 직접 출력하는 최상위 함수 ----------
/**
 * { [stockId]: { [year]: integer } } 를 생성한다 — admin_apply_simulated_prices의
 * p_prices 인자로 그대로 넘길 수 있는 형태다.
 * 종목 수 · 라운드(연도) 수는 전부 입력(stockIds, years)에서 동적으로 결정되며,
 * 상수를 코드에 하드코딩하지 않는다("조 수·시드머니 하드코딩 금지"와 같은 원칙).
 *
 * config.onQuarter가 있으면, 한 라운드(stepsPerYear일) 안에서 25%/50%/75%/100% 지점마다
 * `onQuarter(year, quarterIndex, pricesSnapshot)`를 호출한다(quarterIndex 0~3, 3번째 호출
 * 시점 값이 그 해의 최종 종가와 동일하다) — 미리보기 차트용 분기별 궤적을 위한 훅.
 *
 * 반환값:
 *   기본             → { [stockId]: { [year]: integer } }               (연말 종가만 — 기존 호출부)
 *   returnPath: true → { [stockId]: { [year]: number[stepsPerYear] } }  (연도별 raw 전체 경로)
 */
export function generatePriceSeries(config) {
  const {
    stockIds,
    years,
    seed,
    startPrice = 10000,
    stepsPerYear = 252,
    macroByYear = {}, // { [year]: {unemp,gdp,int_r,inf,sent,fx,oil} } — 없으면 기본 거시값 사용
    baseMu = 0.05,
    weights = defaultWeights(),
    garch = { omega: 0.00001, alpha: 0.1, beta: 0.85 },
    thresholds = { unemp: 5.0, inf: 8.0 },
    jump = { lambda: 2.0, mu: -0.05, sigma: 0.1 },
    correlation = 0.4,
    betaFx, // 종목별 환율 섹터 베타(길이=stockIds.length). 미지정 시 전 종목 0(중립).
    betaOil, // 종목별 유가 섹터 베타. 미지정 시 전 종목 0(중립).
    onQuarter, // 선택: (year, quarterIndex 0~3, pricesSnapshot) => void
    returnPath = false, // true면 연도별 stepsPerYear개 전체 경로를 돌려준다(엔진 트랙 저장용)
  } = config

  if (!Array.isArray(stockIds) || stockIds.length === 0) {
    throw new Error('stockIds는 비어있지 않은 배열이어야 합니다')
  }
  if (!Array.isArray(years) || years.length === 0) {
    throw new Error('years는 비어있지 않은 배열이어야 합니다')
  }

  const sim = new MarketSim({ seed, startPrice, nCompanies: stockIds.length, correlation, betaFx, betaOil })
  const result = {}
  for (const id of stockIds) result[id] = {}

  const quarterCheckpoints = [0.25, 0.5, 0.75, 1.0].map((f) => Math.max(1, Math.round(stepsPerYear * f)))

  for (const year of years) {
    const macro = { ...defaultMacro(), ...(macroByYear[year] ?? {}) }
    const yearPaths = returnPath ? stockIds.map(() => []) : null
    let prices = sim.price
    let quarterIndex = 0
    for (let s = 1; s <= stepsPerYear; s++) {
      prices = sim.step(macro, { baseMu, weights, garch, thresholds, jump })
      if (yearPaths) for (let i = 0; i < stockIds.length; i++) yearPaths[i].push(Math.max(0, Math.round(prices[i])))
      if (onQuarter && quarterIndex < 4 && s >= quarterCheckpoints[quarterIndex]) {
        onQuarter(year, quarterIndex, prices.slice())
        quarterIndex += 1
      }
    }
    while (onQuarter && quarterIndex < 4) {
      onQuarter(year, quarterIndex, prices.slice())
      quarterIndex += 1
    }
    stockIds.forEach((id, i) => {
      result[id][String(year)] = returnPath ? yearPaths[i] : Math.round(prices[i])
    })
  }

  return result
}

// ---------- 6. 단일 라운드 산출 (라운드별 스텝 모드) ----------
/**
 * 현재가(P_t)에서 출발해 하나의 매크로 상태로 한 라운드(stepsPerYear일)만 전진시켜
 * 다음 라운드 가격(P_t+1)을 낸다. generatePriceSeries(다년치 일괄 생성)와 달리
 * "지금 이 라운드 → 다음 라운드"만 필요할 때(대회 진행 중 다음 연도 넘기기 전 미리보기) 쓴다.
 *
 * 반환값:
 *   기본             → { [stockId]: integer }              (마지막 스텝값 하나 — 기존 호출부 호환)
 *   returnPath: true → { [stockId]: number[stepsPerYear] } (매 스텝 정수 가격의 전체 경로)
 * currentPrices에 없는 종목은 startPrice(기본 10000)에서 출발한다.
 */
export function simulateNextRound(config) {
  const {
    stockIds,
    currentPrices, // { [stockId]: number }
    macro = {}, // 단일 거시 상태(연도별 아님) — { unemp,gdp,int_r,inf,sent,fx,oil }
    seed,
    startPrice = 10000,
    stepsPerYear = 252,
    baseMu = 0.05,
    weights = defaultWeights(),
    garch = { omega: 0.00001, alpha: 0.1, beta: 0.85 },
    thresholds = { unemp: 5.0, inf: 8.0 },
    jump = { lambda: 2.0, mu: -0.05, sigma: 0.1 },
    correlation = 0.4,
    betaFx,
    betaOil,
    onQuarter, // 선택: (quarterIndex 0~3, pricesSnapshot) => void
    returnPath = false, // true면 스텝별 전체 경로를 돌려준다(장중 거래용 저장)
  } = config

  if (!Array.isArray(stockIds) || stockIds.length === 0) {
    throw new Error('stockIds는 비어있지 않은 배열이어야 합니다')
  }

  const startPrices = stockIds.map((id) => Number(currentPrices?.[id]) || startPrice)
  const sim = new MarketSim({ seed, startPrices, nCompanies: stockIds.length, correlation, betaFx, betaOil })
  const macroFull = { ...defaultMacro(), ...macro }

  const quarterCheckpoints = [0.25, 0.5, 0.75, 1.0].map((f) => Math.max(1, Math.round(stepsPerYear * f)))
  const paths = returnPath ? stockIds.map(() => []) : null
  let prices = sim.price
  let quarterIndex = 0
  for (let s = 1; s <= stepsPerYear; s++) {
    prices = sim.step(macroFull, { baseMu, weights, garch, thresholds, jump })
    if (paths) for (let i = 0; i < stockIds.length; i++) paths[i].push(Math.max(0, Math.round(prices[i])))
    if (onQuarter && quarterIndex < 4 && s >= quarterCheckpoints[quarterIndex]) {
      onQuarter(quarterIndex, prices.slice())
      quarterIndex += 1
    }
  }
  while (onQuarter && quarterIndex < 4) {
    onQuarter(quarterIndex, prices.slice())
    quarterIndex += 1
  }

  const result = {}
  stockIds.forEach((id, i) => {
    result[id] = returnPath ? paths[i] : Math.round(prices[i])
  })
  return result
}
