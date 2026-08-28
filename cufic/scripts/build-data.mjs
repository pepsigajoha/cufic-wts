// seed_stocks_2025.json + seed_financials_2025.json + (아래 DESC·HINTS) → src/data.js 생성.
//
// data.js는 앱(FinancialModal)·정합성 테스트(data.test)·시드 생성기(gen-seed)의 공통 원천이다.
// 가격·재무는 JSON에서 그대로 컴파일하므로 손으로 옮기다 생기는 오타가 없다.
// 소개·힌트(콘텐츠)만 여기서 관리한다 — 팀이 바꿀 부분.
//
//   데이터 교체:  JSON 수정 (+ 필요시 아래 DESC/HINTS)  →  node scripts/build-data.mjs  →  node scripts/gen-seed.mjs

import { readFileSync, writeFileSync } from 'fs'

const stocksJson = JSON.parse(readFileSync(new URL('../seed_stocks_2025.json', import.meta.url), 'utf8'))
const finJson = JSON.parse(readFileSync(new URL('../seed_financials_2025.json', import.meta.url), 'utf8'))

const PRINCIPAL = 100000000

// 종목 한 줄 소개 (콘텐츠_초안). id → 소개
const DESC = {
  S01: '자동차·생명 보험을 파는 회사예요. 경기가 흔들려도 보험료가 꾸준히 들어와요.',
  S02: '반도체와 전자부품을 만드는 대형 기술 기업이에요. 경기에 따라 실적이 크게 움직여요.',
  S03: '기업용 소프트웨어를 만드는 회사예요. 한 번 계약하면 오래 쓰는 고객이 많아요.',
  S04: '모바일 게임을 만드는 작은 회사예요. 게임 하나가 터지면 회사가 통째로 달라져요.',
  S05: '공격적인 투자로 유명한 금융 회사예요. 벌 때는 크게 벌지만 빚도 많아요.',
  S06: '전기 스쿠터·공유 모빌리티 스타트업이에요. 미래 성장 기대로 주목받았어요.',
  S07: '부품을 납품하는 중소 전자 회사예요. 큰 회사 주문에 실적이 좌우돼요.',
  S08: '라면·간편식을 만드는 식품 회사예요. 화려하진 않지만 꾸준히 팔려요.',
  S09: '전기차를 만드는 자동차 회사예요. 신차 반응에 따라 주가가 크게 출렁여요.',
  S10: '인공지능 서버 장비를 만드는 회사예요. 오랫동안 무명이었지만 기술력은 있다는 평이에요.',
  S11: '복제약과 건강기능식품을 만드는 제약사예요. 신약 개발도 조금씩 하고 있어요.',
  S12: '아이돌 그룹을 키우는 엔터테인먼트 회사예요. 소속 가수 활동에 따라 실적이 요동쳐요.',
  S13: '새로 생긴 온라인 증권사예요. 수수료 무료 정책으로 이용자를 모으고 있어요. (R3 신규 상장)',
  S14: '스포츠 용품 브랜드예요. 한때 SNS에서 크게 유행했던 적이 있어요.',
  S15: '항공기 부품을 만드는 회사예요. 여행 수요와 방산 수주에 영향을 받아요.',
  S16: '신약을 개발하는 바이오 벤처예요. 임상 결과 발표 하나에 주가가 급변해요.',
  S17: '중고 거래 플랫폼을 운영하는 IT 회사예요. 이용자는 많지만 아직 적자예요.',
  S18: '여러 사업을 거느린 대형 지주회사예요. 주가가 비싸고 움직임이 묵직해요.',
}

// 등급 힌트 (콘텐츠_초안). R1은 지급 없음. round 힌트는 그 해→다음 해 등락을 예고한다.
// related는 근거 열의 종목 id. impact는 그 방향(up/down). 시장 전반 힌트는 related [] + flat.
const HINTS = [
  // R2 (2021) → 2022 예고
  { round: 2, grade: 'S', impact: 'up',   headline: "D게임즈 신작, 사전예약 서버가 마비됐다… 업계 '역대급 흥행' 확신", related: ['S04'] },
  { round: 2, grade: 'A', impact: 'down', headline: '거품 논란의 모빌리티 업계, 투자금이 마르고 있다는 소문 — F모빌리티 자금난설', related: ['S06'] },
  { round: 2, grade: 'B', impact: 'up',   headline: '바이오 임상 발표 시즌 도래… 일부 바이오 기업에 큰 장이 설 것이란 전망', related: ['S16'] },
  { round: 2, grade: 'C', impact: 'down', headline: '작년에 SNS에서 유행한 것들, 올해도 유행하리란 법은 없다', related: ['S14'] },
  { round: 2, grade: 'D', impact: 'up',   headline: '시장이 흔들릴 때는 오히려 금융이 웃는다는 옛말이 있다. 늘 맞는 말은 아니지만.', related: ['S05'] },
  // R3 (2022) → 2023 예고
  { round: 3, grade: 'S', impact: 'down', headline: '큐픽플랫폼 회계 부정 의혹 내부 고발… 상장폐지 심사설까지 거론', related: ['S17'] },
  { round: 3, grade: 'A', impact: 'down', headline: '전기차 보조금 대폭 축소 예고 — 전기차·모빌리티 업계 실적 경고등', related: ['S09', 'S06'] },
  { round: 3, grade: 'B', impact: 'up',   headline: '불경기에는 결국 먹는 장사와 약 장사가 남는다는 분석', related: ['S08', 'S11'] },
  { round: 3, grade: 'C', impact: 'up',   headline: '화려한 곳에서 조용한 곳으로, 큰손들의 시선이 옮겨가고 있다', related: ['S10'] },
  { round: 3, grade: 'D', impact: 'flat', headline: "올해는 '살아남는 것'이 수익률이라는 말이 돈다", related: [] },
  // R4 (2023) → 2024 예고
  { round: 4, grade: 'S', impact: 'up',   headline: 'J시스템즈, 글로벌 AI 기업과 서버 공급 계약 임박설 — 사실이면 회사가 달라진다', related: ['S10'] },
  { round: 4, grade: 'A', impact: 'down', headline: "양재금융 부채 만기 집중… 채권단 '상환 능력 의문' — 최악의 경우 상장폐지", related: ['S05'] },
  { round: 4, grade: 'B', impact: 'up',   headline: 'AI 붐이 진짜라면, 서버·반도체·전력 관련주가 먼저 움직인다', related: ['S10', 'S02', 'S07'] },
  { round: 4, grade: 'C', impact: 'up',   headline: '죽었다던 그 플랫폼, 새 주인을 만났다는 소문이 있다', related: ['S17'] },
  { round: 4, grade: 'D', impact: 'down', headline: '바닥인 줄 알았는데 지하실이 있더라 — 어느 투자자의 한탄', related: ['S16', 'S06'] },
  // R5 (2024) → 2025 예고 (최종 정산)
  { round: 5, grade: 'S', impact: 'up',   headline: "M증권, 이용자 1천만 돌파에 흑자 전환까지 — 증권가 '올해의 성장주' 만장일치", related: ['S13'] },
  { round: 5, grade: 'A', impact: 'down', headline: 'F모빌리티 법정관리 신청 초읽기… 주식이 휴지가 될 수 있다는 경고', related: ['S06'] },
  { round: 5, grade: 'B', impact: 'up',   headline: 'K-콘텐츠 해외 매출 사상 최대 전망 — 엔터·게임주 수혜 기대', related: ['S12', 'S04'] },
  { round: 5, grade: 'C', impact: 'down', headline: '작년의 영웅이 올해도 영웅인 경우는 드물다', related: ['S10'] },
  { round: 5, grade: 'D', impact: 'down', headline: '보험을 들어야 할 때와 팔아야 할 때가 있다', related: ['S01'] },
]

// 거시경제 시황(콘텐츠_초안). 연도별 지표 — 가격 스토리와 방향을 맞춘다.
// 2020 코로나 급랭 → 2021 유동성 반등(성장주 급등) → 2022 인플레·금리인상(성장주 조정) → 2023 고금리 둔화 → 2024~ 정상화.
const MACRO = {
  2020: { summary: '코로나 충격으로 경기 급랭 — 초저금리·유가 폭락', kospi: 2300, sp500: 3100, nikkei: 23000, europe: 3300, rate: 0.5, cpi: 0.5, oil: 42, gold: 1900 },
  2021: { summary: '경기 반등·유동성 장세 — 성장주 급등', kospi: 3200, sp500: 4300, nikkei: 28000, europe: 4300, rate: 0.75, cpi: 2.5, oil: 68, gold: 1800 },
  2022: { summary: '인플레이션 급등, 금리 인상 시작 — 성장주 조정', kospi: 2400, sp500: 3600, nikkei: 26000, europe: 3800, rate: 3.25, cpi: 5.1, oil: 95, gold: 1850 },
  2023: { summary: '고금리 지속·경기 둔화 — 실적 옥석 가리기', kospi: 2600, sp500: 4200, nikkei: 33000, europe: 4500, rate: 3.5, cpi: 3.6, oil: 78, gold: 2000 },
  2024: { summary: '금리 인하 기대·완만한 회복', kospi: 2800, sp500: 5100, nikkei: 38000, europe: 4900, rate: 3.0, cpi: 2.3, oil: 80, gold: 2600 },
  2025: { summary: '금리 정상화·안정 국면', kospi: 2900, sp500: 5400, nikkei: 39000, europe: 5100, rate: 2.5, cpi: 2.0, oil: 72, gold: 2750 },
}

// 재무제표 입력 7개: JSON(snake_case) → data.js(camelCase). src/metrics.js FIN_INPUTS의 db→key와 같게 유지.
const FIN_KEY = {
  current_assets: 'currentAssets',
  noncurrent_assets: 'noncurrentAssets',
  current_liabilities: 'currentLiabilities',
  noncurrent_liabilities: 'noncurrentLiabilities',
  revenue: 'revenue',
  operating_expense: 'operatingExpense',
  nonoperating_expense: 'nonoperatingExpense',
}

const financials = {}
for (const [code, years] of Object.entries(finJson.financials)) {
  financials[code] = {}
  for (const [y, row] of Object.entries(years)) {
    financials[code][y] = row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [FIN_KEY[k], v])) : null
  }
}

const ROUNDS = Object.entries(stocksJson.round_year_map)
  .map(([r, y]) => ({ round: Number(r), year: y }))
  .sort((a, b) => a.round - b.round)
const FINAL_YEAR = stocksJson.final_year
const FIN_YEARS = [...ROUNDS.map((r) => r.year), FINAL_YEAR]

const stocks = stocksJson.stocks.map((s) => ({
  name: s.name,
  code: s.id,
  market: 'KOSPI',
  desc: DESC[s.id] ?? '',
  listedFromRound: s.listed_from_round,
  displayOrder: s.display_order,
  priceByYear: s.prices,
}))

const out = `// 자동 생성 파일 — 직접 고치지 말 것.
// 원천: seed_stocks_2025.json + seed_financials_2025.json + scripts/build-data.mjs(소개·힌트).
// 교체: JSON(+소개·힌트) 수정 → \`node scripts/build-data.mjs\` → \`node scripts/gen-seed.mjs\`.
//
// data.js는 FinancialModal·정합성 테스트(data.test)·시드의 공통 원천이다.

export const PRINCIPAL = ${PRINCIPAL} // 조별 시드머니(원금). 관리자가 조별로 바꿀 수 있고, 이건 기본값.
export const initialCash = PRINCIPAL

// 라운드 → 연도. R1=2020 … R5=2024에서 매매하고, 대회 종료 시 FINAL_YEAR로 최종 정산한다.
export const ROUNDS = ${JSON.stringify(ROUNDS)}
export const initialRound = ROUNDS[0]
export const FINAL_YEAR = ${FINAL_YEAR}

// 재무제표에 노출할 연도 (현재 라운드 연도 초과분은 스포일러라 화면에서 가림)
export const FIN_YEARS = ${JSON.stringify(FIN_YEARS)}

// 뉴스/힌트의 related에 종목 대신 쓸 수 있는 값 (전체 시장 등). 지금 데이터엔 미사용.
export const NEWS_SENTINELS = ['전체 시장']

export const initialHistory = []

// 종목. priceByYear 값이 없거나 0이면 거래정지. listedFromRound 이전엔 '상장 예정'.
export const stocks = ${JSON.stringify(stocks, null, 2)}

// 등급 힌트. R1은 없음. round 힌트는 그 해→다음 해 등락을 예고한다(R5는 FINAL_YEAR).
// impact: up=호재(빨강) / down=악재(파랑) / flat=중립(회색). related는 종목 code.
export const initialHints = ${JSON.stringify(HINTS, null, 2)}

// 재무·시황 지표 정의는 src/metrics.js 단일 소스 (교보재팀이 지표를 바꾸면 거기만 수정)
export { FIN_INPUTS, FIN_DERIVED, deriveFinancials, MACRO_METRICS } from './metrics.js'

// 재무제표. null = 미상장/상장폐지 연도(화면에서 '-'). 입력 잎 7개(억원)만 저장, 나머지는 deriveFinancials로 계산.
export const financials = ${JSON.stringify(financials, null, 2)}

// 거시경제 시황. 연도별 지표(현재 라운드 연도 초과분은 스포일러라 화면에서 가린다).
export const MACRO = ${JSON.stringify(MACRO, null, 2)}
`

writeFileSync(new URL('../src/data.js', import.meta.url), out, 'utf8')
console.log(`data.js 생성 — 종목 ${stocks.length}, 힌트 ${HINTS.length}, 라운드 ${ROUNDS.length} (${ROUNDS.map((r) => r.year).join('~')}), FINAL ${FINAL_YEAR}`)
