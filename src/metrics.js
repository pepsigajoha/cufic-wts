// 재무·시황 지표 정의 — 단일 소스(single source of truth).
// 교보재팀이 지표를 바꾸면 **여기만** 고치면 재무·시황 모달·관리자 편집·엑셀 업로드 파서가 함께 따라간다.
//
// 재무제표(v4) 구조 — 입력 잎 7개만 저장하고, 나머지는 전부 계산한다:
//   · 입력(FIN_INPUTS): 유동자산·비유동자산·유동부채·비유동부채 / 매출·영업비용·영업외비용
//   · 계산(FIN_DERIVED): 자산=유동+비유동 · 부채=유동+비유동 · 자본=자산−부채 /
//       영업이익=매출−영업비용 · 당기순이익=영업이익−영업외비용 / 부채비율=부채÷자본×100 · ROE=당기순이익÷자본×100
//   · 자본잠식(자본 ≤ 0): 부채비율·ROE는 계산 불가 → null("—") + impaired 플래그
//   → 계산은 deriveFinancials() 한 곳에서만 한다. DB/시드/데이터셋 payload엔 입력 7개만 담는다.
//
// 각 지표 필드:
//   · key   — 화면·데이터 접근 키(camelCase). data[year][key]
//   · db    — payload/DB 컬럼명(snake_case)
//   · xlsx  — 엑셀 헤더에서 이 열을 찾는 키워드(부분일치). 배열이면 여럿 중 하나
//   · label·unit·desc — 화면 표시(모달 표·용어 설명)
//   · group — 'bs'(재무상태표) | 'pl'(손익계산서)
//   · cost  — true면 비용/차감 항목(모달에서 파란 괄호 표기)
//   · round — true면 정수 반올림(환율·유가)
// data.js는 이 파일을 재-export 한다(하위 호환). 새로 import 하는 코드는 여기서 가져온다.

// ── 재무제표: 입력 잎 7개 (저장·엑셀·편집이 다루는 값)
export const FIN_INPUTS = [
  // 재무상태표
  { key: 'currentAssets', db: 'current_assets', xlsx: '유동자산', label: '유동자산', unit: '억원', group: 'bs', desc: '1년 안에 현금으로 바꿀 수 있는 재산이에요 (현금, 팔 물건 등).' },
  { key: 'noncurrentAssets', db: 'noncurrent_assets', xlsx: '비유동자산', label: '비유동자산', unit: '억원', group: 'bs', desc: '오래 쓰는 재산이에요 (공장, 기계, 건물 등).' },
  { key: 'currentLiabilities', db: 'current_liabilities', xlsx: '유동부채', label: '유동부채', unit: '억원', group: 'bs', desc: '1년 안에 갚아야 할 빚이에요.' },
  { key: 'noncurrentLiabilities', db: 'noncurrent_liabilities', xlsx: '비유동부채', label: '비유동부채', unit: '억원', group: 'bs', desc: '천천히 갚아도 되는 빚이에요.' },
  // 손익계산서
  { key: 'revenue', db: 'revenue', xlsx: '매출', label: '매출', unit: '억원', group: 'pl', desc: '회사가 물건이나 서비스를 팔아서 벌어들인 돈 전체예요.' },
  { key: 'operatingExpense', db: 'operating_expense', xlsx: '영업비용', label: '영업비용', unit: '억원', group: 'pl', cost: true, desc: '장사하는 데 든 돈이에요 (재료비, 인건비 등).' },
  { key: 'nonoperatingExpense', db: 'nonoperating_expense', xlsx: ['영업외비용', '영업외'], label: '영업외비용', unit: '억원', group: 'pl', cost: true, desc: '본업 외에 든 비용이에요 (이자 비용 등).' },
]

// ── 재무제표: 자동 계산 지표 (저장하지 않음. 표시·검증에서만 계산)
export const FIN_DERIVED = [
  { key: 'assets', label: '자산', unit: '억원', group: 'bs', calc: (f) => f.currentAssets + f.noncurrentAssets, desc: '회사가 가진 재산 전부예요 (유동 + 비유동).' },
  { key: 'liabilities', label: '부채', unit: '억원', group: 'bs', calc: (f) => f.currentLiabilities + f.noncurrentLiabilities, desc: '갚아야 할 빚이에요 (유동 + 비유동).' },
  { key: 'equity', label: '자본', unit: '억원', group: 'bs', calc: (f) => f.assets - f.liabilities, desc: '자산에서 빚을 뺀, 진짜 내 돈이에요. 자산 = 부채 + 자본은 항상 성립해요.' },
  { key: 'operatingIncome', label: '영업이익', unit: '억원', group: 'pl', calc: (f) => f.revenue - f.operatingExpense, desc: '본업(매출 − 영업비용)으로 남긴 이익이에요.' },
  { key: 'netIncome', label: '당기순이익', unit: '억원', group: 'pl', calc: (f) => f.operatingIncome - f.nonoperatingExpense, desc: '전부 계산하고 최종적으로 남은 이익이에요.' },
  { key: 'debtRatio', label: '부채비율', unit: '%', calc: (f) => (f.equity > 0 ? (f.liabilities / f.equity) * 100 : null), desc: '내 돈(자본) 대비 빚이 몇 배인지예요. 낮을수록 안정적이에요.' },
  { key: 'roe', label: 'ROE', unit: '%', calc: (f) => (f.equity > 0 ? (f.netIncome / f.equity) * 100 : null), desc: '내 돈으로 얼마나 잘 벌었는지예요. 높을수록 장사를 잘한 거예요.' },
]

const numOr0 = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

/**
 * 입력 7개 → 자동 계산 전부를 붙여 돌려준다. 계산의 유일한 진입점.
 * 미상장/폐지 연도(null/undefined)면 null.
 * 자본 ≤ 0(자본잠식)이면 debtRatio·roe = null, impaired = true.
 * @param {object|null} f 입력값(camelCase key). 일부만 있으면 나머지는 0으로 본다.
 * @returns {null | {…입력7, assets, liabilities, equity, operatingIncome, netIncome, debtRatio, roe, impaired}}
 */
export function deriveFinancials(f) {
  if (!f) return null
  const currentAssets = numOr0(f.currentAssets)
  const noncurrentAssets = numOr0(f.noncurrentAssets)
  const currentLiabilities = numOr0(f.currentLiabilities)
  const noncurrentLiabilities = numOr0(f.noncurrentLiabilities)
  const revenue = numOr0(f.revenue)
  const operatingExpense = numOr0(f.operatingExpense)
  const nonoperatingExpense = numOr0(f.nonoperatingExpense)

  const assets = currentAssets + noncurrentAssets
  const liabilities = currentLiabilities + noncurrentLiabilities
  const equity = assets - liabilities
  const operatingIncome = revenue - operatingExpense
  const netIncome = operatingIncome - nonoperatingExpense
  const impaired = equity <= 0
  const debtRatio = impaired ? null : (liabilities / equity) * 100
  const roe = impaired ? null : (netIncome / equity) * 100

  return {
    currentAssets, noncurrentAssets, currentLiabilities, noncurrentLiabilities,
    revenue, operatingExpense, nonoperatingExpense,
    assets, liabilities, equity, operatingIncome, netIncome, debtRatio, roe, impaired,
  }
}

// 시황 지표 — 시장 지수 4(pt) + 금리·물가(%) + 유가·금($). 순서 = 화면 표시 순서.
export const MACRO_METRICS = [
  { key: 'kospi', db: 'kospi', xlsx: '코스피', label: '코스피지수', unit: 'pt', round: true, desc: '한국 대표 기업 주가지수예요. 국내 증시 전체의 분위기를 보여줘요.' },
  { key: 'sp500', db: 'sp500', xlsx: 'S&P', label: 'S&P 500', unit: 'pt', round: true, desc: '미국 대표 500개 기업 주가지수예요. 세계 증시·투자심리의 바로미터예요.' },
  { key: 'nikkei', db: 'nikkei', xlsx: '일본', label: '일본지수', unit: 'pt', round: true, desc: '일본 대표 주가지수예요. 아시아 증시 흐름의 참고가 돼요.' },
  { key: 'europe', db: 'europe', xlsx: '유럽', label: '유럽지수', unit: 'pt', round: true, desc: '유럽 대표 기업 주가지수예요. 유럽 경기·증시 분위기를 보여줘요.' },
  { key: 'rate', db: 'rate', xlsx: '금리', label: '기준금리', unit: '%', desc: '중앙은행이 정하는 기준 이자율이에요. 높으면 대출·투자가 위축되고 빚 많은 회사·성장주에 불리해요.' },
  { key: 'cpi', db: 'cpi', xlsx: '물가', label: '물가상승률', unit: '%', desc: '물건 값이 1년간 얼마나 올랐는지예요. 너무 높으면 금리를 올려 잡으려 해요.' },
  { key: 'oil', db: 'oil', xlsx: '유가', label: '국제유가', unit: '$', round: true, desc: '원유 1배럴 가격(달러)이에요. 오르면 항공·운송·제조 비용이 커져요.' },
  { key: 'gold', db: 'gold', xlsx: '금($', label: '금', unit: '$/oz', round: true, desc: '금 1온스 가격(달러)이에요. 불안할수록 오르는 안전자산 — 위험 회피 심리의 지표예요.' },
]

// ── 주가 생성기용: 다음 해 재무제표(입력 7개) 추정.
//
// [왜] 엔진이 새 가격 경로를 만들면 시드에 고정돼 있던 재무제표가 그 방향과 어긋난다
// (힌트↔등락 정합성 붕괴 — docs/DATA_GUIDE, data.test 참고). 이 함수가 "가격이 이만큼
// 움직였으면 실적은 대략 이랬을 것"을 결정적으로 계산한다. LLM은 이 숫자에 맞는 설명
// 문장만 쓴다 — 숫자·방향은 전부 여기서.
//
// 모델(단순·결정적, 계수는 교보재팀이 조정 가능):
//   매출   = 전년 × (1 + a·수익률 + b·물가)
//   영업비 = 고정비(물가만 반영) + 변동비 × (1 + 매출성장 − c·수익률)   ← 오른 해엔 마진 확대
//   부채   = 전년 × (1 + b·물가 − d·max(0,수익률))                      ← 크게 오른 해엔 소폭 디레버리지
//   영업외비 = 부채 × 유효조달금리,  유효금리 += e·Δ기준금리
//   자본   = 전년자본 + f·당기순이익 − 손상차손
//   손상차손 = 가격이 −50%보다 더 빠진 해에 (−0.5 − 수익률)의 g 배만큼 자산을 상각(최대 60%)
//   자산   = 자본 + 부채  → 유동/비유동은 전년 비율로 분할
// 자본이 음수가 되면(자본잠식) 그대로 둔다 — deriveFinancials가 impaired 처리한다.
export const DEFAULT_FIN_MODEL = {
  revToReturn: 0.35, // a: 가격 +100% → 매출 +35%
  inflPassThru: 0.6, // b: 물가상승률의 60%가 명목 매출·부채·고정비에 반영
  marginLift: 0.12, // c: 가격 상승 시 영업마진 확대폭
  fixedCostShare: 0.4, // 영업비 중 매출과 무관하게 버티는 고정비 비중(영업 레버리지)
  deleverOnGain: 0.05, // d: 크게 오른 해에 부채 축소
  rateToInterest: 0.5, // e: 기준금리 +1%p → 유효 조달금리 +0.5%p
  retainedRatio: 0.5, // f: 당기순이익의 50%가 자본에 유보(나머지는 배당 등)
  crashWritedown: 0.5, // g: −50% 아래 초과분의 절반을 자산 손상차손으로
}

const clampFrac = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const nnInt = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v) : 0) // 음수·NaN 방지 + 정수

/**
 * 다음 해 재무 입력 7개를 추정한다.
 * @param {object|null} prev  전년 입력 7개(camelCase). null이면 null.
 * @param {object} ctx
 * @param {number} ctx.priceReturn  (다음해 가격 − 올해 가격) / 올해 가격 (예: 0.18 = +18%)
 * @param {{rate?:number, cpi?:number}} [ctx.macroPrev]  올해 시황 (%)
 * @param {{rate?:number, cpi?:number}} [ctx.macroNext]  다음해 시황 (%)
 * @param {Partial<typeof DEFAULT_FIN_MODEL>} [model]
 * @returns {object|null} 다음 해 입력 7개(camelCase 정수)
 */
export function deriveNextFinancials(prev, ctx = {}, model = DEFAULT_FIN_MODEL) {
  if (!prev) return null
  const m = { ...DEFAULT_FIN_MODEL, ...model }
  const r = Number(ctx.priceReturn) || 0

  const cpiNext = Number(ctx.macroNext?.cpi)
  const infl = Number.isFinite(cpiNext) ? clampFrac(cpiNext / 100, -0.1, 0.3) : 0
  const rp = Number(ctx.macroPrev?.rate)
  const rn = Number(ctx.macroNext?.rate)
  const dRate = Number.isFinite(rp) && Number.isFinite(rn) ? (rn - rp) / 100 : 0

  const CA0 = Math.max(0, Number(prev.currentAssets) || 0)
  const NCA0 = Math.max(0, Number(prev.noncurrentAssets) || 0)
  const CL0 = Math.max(0, Number(prev.currentLiabilities) || 0)
  const NCL0 = Math.max(0, Number(prev.noncurrentLiabilities) || 0)
  const rev0 = Math.max(0, Number(prev.revenue) || 0)
  const opex0 = Math.max(0, Number(prev.operatingExpense) || 0)
  const nonop0 = Math.max(0, Number(prev.nonoperatingExpense) || 0)

  const assets0 = CA0 + NCA0
  const debt0 = CL0 + NCL0
  const equity0 = assets0 - debt0
  const caRatio = assets0 > 0 ? CA0 / assets0 : 0.5

  // 손익
  const revGrowth = m.revToReturn * r + m.inflPassThru * infl
  const revenue = nnInt(rev0 * (1 + revGrowth))
  const fixed = opex0 * m.fixedCostShare * (1 + m.inflPassThru * infl)
  const variable = opex0 * (1 - m.fixedCostShare) * (1 + revGrowth - m.marginLift * r)
  const operatingExpense = nnInt(fixed + variable)

  // 부채
  const debtGrowth = m.inflPassThru * infl - m.deleverOnGain * Math.max(0, r)
  const currentLiabilities = nnInt(CL0 * (1 + debtGrowth))
  const noncurrentLiabilities = nnInt(NCL0 * (1 + debtGrowth))
  const debt1 = currentLiabilities + noncurrentLiabilities

  // 영업외비용(이자) — 부채 × 유효 조달금리, 금리 변화 반영
  const effRate = Math.max(0, (debt0 > 0 ? nonop0 / debt0 : 0) + m.rateToInterest * dRate)
  const nonoperatingExpense = nnInt(debt1 * effRate)

  // 자본·자산
  const netIncome = revenue - operatingExpense - nonoperatingExpense
  const writedown = r < -0.5 ? clampFrac(m.crashWritedown * (-0.5 - r), 0, 0.6) : 0
  const equity1 = equity0 + m.retainedRatio * netIncome - assets0 * writedown
  const assets1 = equity1 + debt1
  const currentAssets = nnInt(assets1 * caRatio)
  const noncurrentAssets = nnInt(assets1 * (1 - caRatio))

  return {
    currentAssets,
    noncurrentAssets,
    currentLiabilities,
    noncurrentLiabilities,
    revenue,
    operatingExpense,
    nonoperatingExpense,
  }
}
