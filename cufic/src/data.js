// 자동 생성 파일 — 직접 고치지 말 것.
// 원천: seed_stocks_2025.json + seed_financials_2025.json + scripts/build-data.mjs(소개·힌트).
// 교체: JSON(+소개·힌트) 수정 → `node scripts/build-data.mjs` → `node scripts/gen-seed.mjs`.
//
// data.js는 FinancialModal·정합성 테스트(data.test)·시드의 공통 원천이다.

export const PRINCIPAL = 100000000 // 조별 시드머니(원금). 관리자가 조별로 바꿀 수 있고, 이건 기본값.
export const initialCash = PRINCIPAL

// 라운드 → 연도. R1=2020 … R5=2024에서 매매하고, 대회 종료 시 FINAL_YEAR로 최종 정산한다.
export const ROUNDS = [{"round":1,"year":2020},{"round":2,"year":2021},{"round":3,"year":2022},{"round":4,"year":2023},{"round":5,"year":2024}]
export const initialRound = ROUNDS[0]
export const FINAL_YEAR = 2025

// 재무제표에 노출할 연도 (현재 라운드 연도 초과분은 스포일러라 화면에서 가림)
export const FIN_YEARS = [2020,2021,2022,2023,2024,2025]

// 뉴스/힌트의 related에 종목 대신 쓸 수 있는 값 (전체 시장 등). 지금 데이터엔 미사용.
export const NEWS_SENTINELS = ['전체 시장']

export const initialHistory = []

// 종목. priceByYear 값이 없거나 0이면 거래정지. listedFromRound 이전엔 '상장 예정'.
export const stocks = [
  {
    "name": "승주보험",
    "code": "S01",
    "market": "KOSPI",
    "desc": "자동차·생명 보험을 파는 회사예요. 경기가 흔들려도 보험료가 꾸준히 들어와요.",
    "listedFromRound": 1,
    "displayOrder": 1,
    "priceByYear": {
      "2020": 29300,
      "2021": 35000,
      "2022": 50200,
      "2023": 53000,
      "2024": 52600,
      "2025": 33000
    }
  },
  {
    "name": "백만전자",
    "code": "S02",
    "market": "KOSPI",
    "desc": "반도체와 전자부품을 만드는 대형 기술 기업이에요. 경기에 따라 실적이 크게 움직여요.",
    "listedFromRound": 1,
    "displayOrder": 2,
    "priceByYear": {
      "2020": 7300,
      "2021": 13200,
      "2022": 17700,
      "2023": 12900,
      "2024": 19200,
      "2025": 25000
    }
  },
  {
    "name": "C소프트",
    "code": "S03",
    "market": "KOSPI",
    "desc": "기업용 소프트웨어를 만드는 회사예요. 한 번 계약하면 오래 쓰는 고객이 많아요.",
    "listedFromRound": 1,
    "displayOrder": 3,
    "priceByYear": {
      "2020": 10700,
      "2021": 14300,
      "2022": 13100,
      "2023": 12200,
      "2024": 13600,
      "2025": 20400
    }
  },
  {
    "name": "D게임즈",
    "code": "S04",
    "market": "KOSPI",
    "desc": "모바일 게임을 만드는 작은 회사예요. 게임 하나가 터지면 회사가 통째로 달라져요.",
    "listedFromRound": 1,
    "displayOrder": 4,
    "priceByYear": {
      "2020": 100,
      "2021": 400,
      "2022": 3700,
      "2023": 1800,
      "2024": 1700,
      "2025": 3100
    }
  },
  {
    "name": "양재금융",
    "code": "S05",
    "market": "KOSPI",
    "desc": "공격적인 투자로 유명한 금융 회사예요. 벌 때는 크게 벌지만 빚도 많아요.",
    "listedFromRound": 1,
    "displayOrder": 5,
    "priceByYear": {
      "2020": 25100,
      "2021": 38800,
      "2022": 67800,
      "2023": 31000,
      "2024": 0,
      "2025": 0
    }
  },
  {
    "name": "F모빌리티",
    "code": "S06",
    "market": "KOSPI",
    "desc": "전기 스쿠터·공유 모빌리티 스타트업이에요. 미래 성장 기대로 주목받았어요.",
    "listedFromRound": 1,
    "displayOrder": 6,
    "priceByYear": {
      "2020": 30900,
      "2021": 187700,
      "2022": 47800,
      "2023": 18100,
      "2024": 3700,
      "2025": 0
    }
  },
  {
    "name": "형록전자",
    "code": "S07",
    "market": "KOSPI",
    "desc": "부품을 납품하는 중소 전자 회사예요. 큰 회사 주문에 실적이 좌우돼요.",
    "listedFromRound": 1,
    "displayOrder": 7,
    "priceByYear": {
      "2020": 5900,
      "2021": 4900,
      "2022": 5100,
      "2023": 2600,
      "2024": 5000,
      "2025": 2000
    }
  },
  {
    "name": "백학푸드",
    "code": "S08",
    "market": "KOSPI",
    "desc": "라면·간편식을 만드는 식품 회사예요. 화려하진 않지만 꾸준히 팔려요.",
    "listedFromRound": 1,
    "displayOrder": 8,
    "priceByYear": {
      "2020": 5500,
      "2021": 5400,
      "2022": 5900,
      "2023": 6300,
      "2024": 5800,
      "2025": 6200
    }
  },
  {
    "name": "I모터스",
    "code": "S09",
    "market": "KOSPI",
    "desc": "전기차를 만드는 자동차 회사예요. 신차 반응에 따라 주가가 크게 출렁여요.",
    "listedFromRound": 1,
    "displayOrder": 9,
    "priceByYear": {
      "2020": 2700,
      "2021": 23500,
      "2022": 35200,
      "2023": 12300,
      "2024": 24800,
      "2025": 40300
    }
  },
  {
    "name": "J시스템즈",
    "code": "S10",
    "market": "KOSPI",
    "desc": "인공지능 서버 장비를 만드는 회사예요. 오랫동안 무명이었지만 기술력은 있다는 평이에요.",
    "listedFromRound": 1,
    "displayOrder": 10,
    "priceByYear": {
      "2020": 200,
      "2021": 300,
      "2022": 400,
      "2023": 600,
      "2024": 7000,
      "2025": 2200
    }
  },
  {
    "name": "경상제약",
    "code": "S11",
    "market": "KOSPI",
    "desc": "복제약과 건강기능식품을 만드는 제약사예요. 신약 개발도 조금씩 하고 있어요.",
    "listedFromRound": 1,
    "displayOrder": 11,
    "priceByYear": {
      "2020": 2800,
      "2021": 3400,
      "2022": 5600,
      "2023": 6700,
      "2024": 10300,
      "2025": 8600
    }
  },
  {
    "name": "HeeSoo ENT.",
    "code": "S12",
    "market": "KOSPI",
    "desc": "아이돌 그룹을 키우는 엔터테인먼트 회사예요. 소속 가수 활동에 따라 실적이 요동쳐요.",
    "listedFromRound": 1,
    "displayOrder": 12,
    "priceByYear": {
      "2020": 3200,
      "2021": 5400,
      "2022": 6000,
      "2023": 2900,
      "2024": 4800,
      "2025": 8900
    }
  },
  {
    "name": "M증권",
    "code": "S13",
    "market": "KOSPI",
    "desc": "새로 생긴 온라인 증권사예요. 수수료 무료 정책으로 이용자를 모으고 있어요. (R3 신규 상장)",
    "listedFromRound": 3,
    "displayOrder": 13,
    "priceByYear": {
      "2020": 0,
      "2021": 0,
      "2022": 1700,
      "2023": 800,
      "2024": 1200,
      "2025": 3700
    }
  },
  {
    "name": "N스포츠",
    "code": "S14",
    "market": "KOSPI",
    "desc": "스포츠 용품 브랜드예요. 한때 SNS에서 크게 유행했던 적이 있어요.",
    "listedFromRound": 1,
    "displayOrder": 14,
    "priceByYear": {
      "2020": 2800,
      "2021": 15100,
      "2022": 3500,
      "2023": 700,
      "2024": 600,
      "2025": 800
    }
  },
  {
    "name": "O에어로",
    "code": "S15",
    "market": "KOSPI",
    "desc": "항공기 부품을 만드는 회사예요. 여행 수요와 방산 수주에 영향을 받아요.",
    "listedFromRound": 1,
    "displayOrder": 15,
    "priceByYear": {
      "2020": 32500,
      "2021": 21400,
      "2022": 20100,
      "2023": 19000,
      "2024": 26000,
      "2025": 17700
    }
  },
  {
    "name": "윤선바이오",
    "code": "S16",
    "market": "KOSPI",
    "desc": "신약을 개발하는 바이오 벤처예요. 임상 결과 발표 하나에 주가가 급변해요.",
    "listedFromRound": 1,
    "displayOrder": 16,
    "priceByYear": {
      "2020": 1900,
      "2021": 10400,
      "2022": 25300,
      "2023": 17900,
      "2024": 9900,
      "2025": 4100
    }
  },
  {
    "name": "큐픽플랫폼",
    "code": "S17",
    "market": "KOSPI",
    "desc": "중고 거래 플랫폼을 운영하는 IT 회사예요. 이용자는 많지만 아직 적자예요.",
    "listedFromRound": 1,
    "displayOrder": 17,
    "priceByYear": {
      "2020": 1800,
      "2021": 4700,
      "2022": 4600,
      "2023": 100,
      "2024": 1000,
      "2025": 4000
    }
  },
  {
    "name": "하프케이",
    "code": "S18",
    "market": "KOSPI",
    "desc": "여러 사업을 거느린 대형 지주회사예요. 주가가 비싸고 움직임이 묵직해요.",
    "listedFromRound": 1,
    "displayOrder": 18,
    "priceByYear": {
      "2020": 323000,
      "2021": 375600,
      "2022": 475500,
      "2023": 383900,
      "2024": 476900,
      "2025": 588100
    }
  }
]

// 등급 힌트. R1은 없음. round 힌트는 그 해→다음 해 등락을 예고한다(R5는 FINAL_YEAR).
// impact: up=호재(빨강) / down=악재(파랑) / flat=중립(회색). related는 종목 code.
export const initialHints = [
  {
    "round": 2,
    "grade": "S",
    "impact": "up",
    "headline": "D게임즈 신작, 사전예약 서버가 마비됐다… 업계 '역대급 흥행' 확신",
    "related": [
      "S04"
    ]
  },
  {
    "round": 2,
    "grade": "A",
    "impact": "down",
    "headline": "거품 논란의 모빌리티 업계, 투자금이 마르고 있다는 소문 — F모빌리티 자금난설",
    "related": [
      "S06"
    ]
  },
  {
    "round": 2,
    "grade": "B",
    "impact": "up",
    "headline": "바이오 임상 발표 시즌 도래… 일부 바이오 기업에 큰 장이 설 것이란 전망",
    "related": [
      "S16"
    ]
  },
  {
    "round": 2,
    "grade": "C",
    "impact": "down",
    "headline": "작년에 SNS에서 유행한 것들, 올해도 유행하리란 법은 없다",
    "related": [
      "S14"
    ]
  },
  {
    "round": 2,
    "grade": "D",
    "impact": "up",
    "headline": "시장이 흔들릴 때는 오히려 금융이 웃는다는 옛말이 있다. 늘 맞는 말은 아니지만.",
    "related": [
      "S05"
    ]
  },
  {
    "round": 3,
    "grade": "S",
    "impact": "down",
    "headline": "큐픽플랫폼 회계 부정 의혹 내부 고발… 상장폐지 심사설까지 거론",
    "related": [
      "S17"
    ]
  },
  {
    "round": 3,
    "grade": "A",
    "impact": "down",
    "headline": "전기차 보조금 대폭 축소 예고 — 전기차·모빌리티 업계 실적 경고등",
    "related": [
      "S09",
      "S06"
    ]
  },
  {
    "round": 3,
    "grade": "B",
    "impact": "up",
    "headline": "불경기에는 결국 먹는 장사와 약 장사가 남는다는 분석",
    "related": [
      "S08",
      "S11"
    ]
  },
  {
    "round": 3,
    "grade": "C",
    "impact": "up",
    "headline": "화려한 곳에서 조용한 곳으로, 큰손들의 시선이 옮겨가고 있다",
    "related": [
      "S10"
    ]
  },
  {
    "round": 3,
    "grade": "D",
    "impact": "flat",
    "headline": "올해는 '살아남는 것'이 수익률이라는 말이 돈다",
    "related": []
  },
  {
    "round": 4,
    "grade": "S",
    "impact": "up",
    "headline": "J시스템즈, 글로벌 AI 기업과 서버 공급 계약 임박설 — 사실이면 회사가 달라진다",
    "related": [
      "S10"
    ]
  },
  {
    "round": 4,
    "grade": "A",
    "impact": "down",
    "headline": "양재금융 부채 만기 집중… 채권단 '상환 능력 의문' — 최악의 경우 상장폐지",
    "related": [
      "S05"
    ]
  },
  {
    "round": 4,
    "grade": "B",
    "impact": "up",
    "headline": "AI 붐이 진짜라면, 서버·반도체·전력 관련주가 먼저 움직인다",
    "related": [
      "S10",
      "S02",
      "S07"
    ]
  },
  {
    "round": 4,
    "grade": "C",
    "impact": "up",
    "headline": "죽었다던 그 플랫폼, 새 주인을 만났다는 소문이 있다",
    "related": [
      "S17"
    ]
  },
  {
    "round": 4,
    "grade": "D",
    "impact": "down",
    "headline": "바닥인 줄 알았는데 지하실이 있더라 — 어느 투자자의 한탄",
    "related": [
      "S16",
      "S06"
    ]
  },
  {
    "round": 5,
    "grade": "S",
    "impact": "up",
    "headline": "M증권, 이용자 1천만 돌파에 흑자 전환까지 — 증권가 '올해의 성장주' 만장일치",
    "related": [
      "S13"
    ]
  },
  {
    "round": 5,
    "grade": "A",
    "impact": "down",
    "headline": "F모빌리티 법정관리 신청 초읽기… 주식이 휴지가 될 수 있다는 경고",
    "related": [
      "S06"
    ]
  },
  {
    "round": 5,
    "grade": "B",
    "impact": "up",
    "headline": "K-콘텐츠 해외 매출 사상 최대 전망 — 엔터·게임주 수혜 기대",
    "related": [
      "S12",
      "S04"
    ]
  },
  {
    "round": 5,
    "grade": "C",
    "impact": "down",
    "headline": "작년의 영웅이 올해도 영웅인 경우는 드물다",
    "related": [
      "S10"
    ]
  },
  {
    "round": 5,
    "grade": "D",
    "impact": "down",
    "headline": "보험을 들어야 할 때와 팔아야 할 때가 있다",
    "related": [
      "S01"
    ]
  }
]

// 재무·시황 지표 정의는 src/metrics.js 단일 소스 (교보재팀이 지표를 바꾸면 거기만 수정)
export { FIN_INPUTS, FIN_DERIVED, deriveFinancials, MACRO_METRICS } from './metrics.js'

// 재무제표. null = 미상장/상장폐지 연도(화면에서 '-'). 입력 잎 7개(억원)만 저장, 나머지는 deriveFinancials로 계산.
export const financials = {
  "S01": {
    "2020": {
      "currentAssets": 27529,
      "noncurrentAssets": 27529,
      "currentLiabilities": 10729,
      "noncurrentLiabilities": 16094,
      "revenue": 38000,
      "operatingExpense": 34800,
      "nonoperatingExpense": 800
    },
    "2021": {
      "currentAssets": 29388,
      "noncurrentAssets": 29387,
      "currentLiabilities": 11265,
      "noncurrentLiabilities": 16898,
      "revenue": 40500,
      "operatingExpense": 36600,
      "nonoperatingExpense": 900
    },
    "2022": {
      "currentAssets": 30505,
      "noncurrentAssets": 30504,
      "currentLiabilities": 11560,
      "noncurrentLiabilities": 17339,
      "revenue": 43800,
      "operatingExpense": 39200,
      "nonoperatingExpense": 1100
    },
    "2023": {
      "currentAssets": 32204,
      "noncurrentAssets": 32203,
      "currentLiabilities": 12059,
      "noncurrentLiabilities": 18089,
      "revenue": 45200,
      "operatingExpense": 40400,
      "nonoperatingExpense": 1100
    },
    "2024": {
      "currentAssets": 33684,
      "noncurrentAssets": 33683,
      "currentLiabilities": 12689,
      "noncurrentLiabilities": 19034,
      "revenue": 45900,
      "operatingExpense": 41200,
      "nonoperatingExpense": 1100
    },
    "2025": {
      "currentAssets": 36653,
      "noncurrentAssets": 36652,
      "currentLiabilities": 14878,
      "noncurrentLiabilities": 22316,
      "revenue": 44100,
      "operatingExpense": 42000,
      "nonoperatingExpense": 800
    }
  },
  "S02": {
    "2020": {
      "currentAssets": 125827,
      "noncurrentAssets": 125826,
      "currentLiabilities": 31240,
      "noncurrentLiabilities": 46859,
      "revenue": 236000,
      "operatingExpense": 208000,
      "nonoperatingExpense": 7000
    },
    "2021": {
      "currentAssets": 137697,
      "noncurrentAssets": 137696,
      "currentLiabilities": 32582,
      "noncurrentLiabilities": 48872,
      "revenue": 268000,
      "operatingExpense": 227000,
      "nonoperatingExpense": 9000
    },
    "2022": {
      "currentAssets": 144971,
      "noncurrentAssets": 144970,
      "currentLiabilities": 33136,
      "noncurrentLiabilities": 49704,
      "revenue": 292000,
      "operatingExpense": 246000,
      "nonoperatingExpense": 11000
    },
    "2023": {
      "currentAssets": 151938,
      "noncurrentAssets": 151937,
      "currentLiabilities": 36550,
      "noncurrentLiabilities": 54825,
      "revenue": 245000,
      "operatingExpense": 235500,
      "nonoperatingExpense": 2700
    },
    "2024": {
      "currentAssets": 159727,
      "noncurrentAssets": 159727,
      "currentLiabilities": 37156,
      "noncurrentLiabilities": 55735,
      "revenue": 289000,
      "operatingExpense": 251000,
      "nonoperatingExpense": 9000
    },
    "2025": {
      "currentAssets": 177070,
      "noncurrentAssets": 177070,
      "currentLiabilities": 39745,
      "noncurrentLiabilities": 59618,
      "revenue": 331000,
      "operatingExpense": 279000,
      "nonoperatingExpense": 12000
    }
  },
  "S03": {
    "2020": {
      "currentAssets": 9643,
      "noncurrentAssets": 9643,
      "currentLiabilities": 2000,
      "noncurrentLiabilities": 3000,
      "revenue": 12400,
      "operatingExpense": 10300,
      "nonoperatingExpense": 500
    },
    "2021": {
      "currentAssets": 10190,
      "noncurrentAssets": 10190,
      "currentLiabilities": 2023,
      "noncurrentLiabilities": 3034,
      "revenue": 13800,
      "operatingExpense": 11300,
      "nonoperatingExpense": 600
    },
    "2022": {
      "currentAssets": 10746,
      "noncurrentAssets": 10745,
      "currentLiabilities": 2181,
      "noncurrentLiabilities": 3272,
      "revenue": 13200,
      "operatingExpense": 11000,
      "nonoperatingExpense": 500
    },
    "2023": {
      "currentAssets": 11045,
      "noncurrentAssets": 11044,
      "currentLiabilities": 2242,
      "noncurrentLiabilities": 3363,
      "revenue": 12900,
      "operatingExpense": 10900,
      "nonoperatingExpense": 500
    },
    "2024": {
      "currentAssets": 11534,
      "noncurrentAssets": 11534,
      "currentLiabilities": 2237,
      "noncurrentLiabilities": 3355,
      "revenue": 13600,
      "operatingExpense": 11300,
      "nonoperatingExpense": 500
    },
    "2025": {
      "currentAssets": 12094,
      "noncurrentAssets": 12093,
      "currentLiabilities": 2233,
      "noncurrentLiabilities": 3349,
      "revenue": 15900,
      "operatingExpense": 12800,
      "nonoperatingExpense": 700
    }
  },
  "S04": {
    "2020": {
      "currentAssets": 84,
      "noncurrentAssets": 84,
      "currentLiabilities": 43,
      "noncurrentLiabilities": 65,
      "revenue": 120,
      "operatingExpense": 155,
      "nonoperatingExpense": 5
    },
    "2021": {
      "currentAssets": 250,
      "noncurrentAssets": 250,
      "currentLiabilities": 120,
      "noncurrentLiabilities": 180,
      "revenue": 310,
      "operatingExpense": 290,
      "nonoperatingExpense": 8
    },
    "2022": {
      "currentAssets": 1751,
      "noncurrentAssets": 1750,
      "currentLiabilities": 525,
      "noncurrentLiabilities": 788,
      "revenue": 2850,
      "operatingExpense": 1500,
      "nonoperatingExpense": 300
    },
    "2023": {
      "currentAssets": 2144,
      "noncurrentAssets": 2143,
      "currentLiabilities": 706,
      "noncurrentLiabilities": 1059,
      "revenue": 1420,
      "operatingExpense": 1040,
      "nonoperatingExpense": 90
    },
    "2024": {
      "currentAssets": 2316,
      "noncurrentAssets": 2316,
      "currentLiabilities": 794,
      "noncurrentLiabilities": 1191,
      "revenue": 1180,
      "operatingExpense": 940,
      "nonoperatingExpense": 60
    },
    "2025": {
      "currentAssets": 2434,
      "noncurrentAssets": 2434,
      "currentLiabilities": 767,
      "noncurrentLiabilities": 1151,
      "revenue": 1650,
      "operatingExpense": 1130,
      "nonoperatingExpense": 110
    }
  },
  "S05": {
    "2020": {
      "currentAssets": 24001,
      "noncurrentAssets": 24001,
      "currentLiabilities": 14629,
      "noncurrentLiabilities": 21944,
      "revenue": 8900,
      "operatingExpense": 6800,
      "nonoperatingExpense": 500
    },
    "2021": {
      "currentAssets": 38510,
      "noncurrentAssets": 38510,
      "currentLiabilities": 24767,
      "noncurrentLiabilities": 37151,
      "revenue": 14200,
      "operatingExpense": 9400,
      "nonoperatingExpense": 1100
    },
    "2022": {
      "currentAssets": 62967,
      "noncurrentAssets": 62966,
      "currentLiabilities": 42502,
      "noncurrentLiabilities": 63754,
      "revenue": 21500,
      "operatingExpense": 13600,
      "nonoperatingExpense": 1800
    },
    "2023": {
      "currentAssets": 24255,
      "noncurrentAssets": 24255,
      "currentLiabilities": 17444,
      "noncurrentLiabilities": 26166,
      "revenue": 9800,
      "operatingExpense": 15000,
      "nonoperatingExpense": 1600
    },
    "2024": null,
    "2025": null
  },
  "S06": {
    "2020": {
      "currentAssets": 659,
      "noncurrentAssets": 659,
      "currentLiabilities": 357,
      "noncurrentLiabilities": 536,
      "revenue": 850,
      "operatingExpense": 1270,
      "nonoperatingExpense": 60
    },
    "2021": {
      "currentAssets": 2160,
      "noncurrentAssets": 2160,
      "currentLiabilities": 1248,
      "noncurrentLiabilities": 1872,
      "revenue": 2400,
      "operatingExpense": 3080,
      "nonoperatingExpense": 70
    },
    "2022": {
      "currentAssets": 3480,
      "noncurrentAssets": 3480,
      "currentLiabilities": 2204,
      "noncurrentLiabilities": 3306,
      "revenue": 2900,
      "operatingExpense": 4000,
      "nonoperatingExpense": 150
    },
    "2023": {
      "currentAssets": 3255,
      "noncurrentAssets": 3255,
      "currentLiabilities": 2184,
      "noncurrentLiabilities": 3276,
      "revenue": 2100,
      "operatingExpense": 3050,
      "nonoperatingExpense": 130
    },
    "2024": {
      "currentAssets": 2640,
      "noncurrentAssets": 2640,
      "currentLiabilities": 1872,
      "noncurrentLiabilities": 2808,
      "revenue": 1200,
      "operatingExpense": 1900,
      "nonoperatingExpense": 120
    },
    "2025": null
  },
  "S07": {
    "2020": {
      "currentAssets": 3069,
      "noncurrentAssets": 3069,
      "currentLiabilities": 1286,
      "noncurrentLiabilities": 1929,
      "revenue": 4200,
      "operatingExpense": 3940,
      "nonoperatingExpense": 70
    },
    "2021": {
      "currentAssets": 3147,
      "noncurrentAssets": 3146,
      "currentLiabilities": 1346,
      "noncurrentLiabilities": 2020,
      "revenue": 3900,
      "operatingExpense": 3720,
      "nonoperatingExpense": 60
    },
    "2022": {
      "currentAssets": 3180,
      "noncurrentAssets": 3180,
      "currentLiabilities": 1344,
      "noncurrentLiabilities": 2016,
      "revenue": 4100,
      "operatingExpense": 3890,
      "nonoperatingExpense": 60
    },
    "2023": {
      "currentAssets": 1822,
      "noncurrentAssets": 1821,
      "currentLiabilities": 837,
      "noncurrentLiabilities": 1256,
      "revenue": 3100,
      "operatingExpense": 3340,
      "nonoperatingExpense": 70
    },
    "2024": {
      "currentAssets": 3124,
      "noncurrentAssets": 3124,
      "currentLiabilities": 1280,
      "noncurrentLiabilities": 1920,
      "revenue": 4600,
      "operatingExpense": 4180,
      "nonoperatingExpense": 100
    },
    "2025": {
      "currentAssets": 1938,
      "noncurrentAssets": 1938,
      "currentLiabilities": 870,
      "noncurrentLiabilities": 1306,
      "revenue": 3400,
      "operatingExpense": 3520,
      "nonoperatingExpense": 60
    }
  },
  "S08": {
    "2020": {
      "currentAssets": 12375,
      "noncurrentAssets": 12375,
      "currentLiabilities": 3789,
      "noncurrentLiabilities": 5683,
      "revenue": 21000,
      "operatingExpense": 19500,
      "nonoperatingExpense": 400
    },
    "2021": {
      "currentAssets": 12681,
      "noncurrentAssets": 12681,
      "currentLiabilities": 3844,
      "noncurrentLiabilities": 5765,
      "revenue": 21400,
      "operatingExpense": 19850,
      "nonoperatingExpense": 400
    },
    "2022": {
      "currentAssets": 13128,
      "noncurrentAssets": 13128,
      "currentLiabilities": 3938,
      "noncurrentLiabilities": 5908,
      "revenue": 22800,
      "operatingExpense": 21100,
      "nonoperatingExpense": 420
    },
    "2023": {
      "currentAssets": 13655,
      "noncurrentAssets": 13654,
      "currentLiabilities": 4010,
      "noncurrentLiabilities": 6015,
      "revenue": 24100,
      "operatingExpense": 22250,
      "nonoperatingExpense": 450
    },
    "2024": {
      "currentAssets": 14033,
      "noncurrentAssets": 14033,
      "currentLiabilities": 4121,
      "noncurrentLiabilities": 6182,
      "revenue": 24600,
      "operatingExpense": 22800,
      "nonoperatingExpense": 450
    },
    "2025": {
      "currentAssets": 14613,
      "noncurrentAssets": 14612,
      "currentLiabilities": 4196,
      "noncurrentLiabilities": 6295,
      "revenue": 25900,
      "operatingExpense": 23950,
      "nonoperatingExpense": 470
    }
  },
  "S09": {
    "2020": {
      "currentAssets": 55417,
      "noncurrentAssets": 55416,
      "currentLiabilities": 26238,
      "noncurrentLiabilities": 39357,
      "revenue": 98000,
      "operatingExpense": 95200,
      "nonoperatingExpense": 900
    },
    "2021": {
      "currentAssets": 61094,
      "noncurrentAssets": 61094,
      "currentLiabilities": 27625,
      "noncurrentLiabilities": 41438,
      "revenue": 132000,
      "operatingExpense": 123100,
      "nonoperatingExpense": 2100
    },
    "2022": {
      "currentAssets": 67692,
      "noncurrentAssets": 67692,
      "currentLiabilities": 29538,
      "noncurrentLiabilities": 44308,
      "revenue": 158000,
      "operatingExpense": 145500,
      "nonoperatingExpense": 2900
    },
    "2023": {
      "currentAssets": 73466,
      "noncurrentAssets": 73466,
      "currentLiabilities": 32995,
      "noncurrentLiabilities": 49493,
      "revenue": 141000,
      "operatingExpense": 136800,
      "nonoperatingExpense": 1300
    },
    "2024": {
      "currentAssets": 77752,
      "noncurrentAssets": 77751,
      "currentLiabilities": 33270,
      "noncurrentLiabilities": 49906,
      "revenue": 172000,
      "operatingExpense": 157200,
      "nonoperatingExpense": 3300
    },
    "2025": {
      "currentAssets": 86383,
      "noncurrentAssets": 86382,
      "currentLiabilities": 35882,
      "noncurrentLiabilities": 53823,
      "revenue": 198000,
      "operatingExpense": 178500,
      "nonoperatingExpense": 4300
    }
  },
  "S10": {
    "2020": {
      "currentAssets": 390,
      "noncurrentAssets": 390,
      "currentLiabilities": 152,
      "noncurrentLiabilities": 228,
      "revenue": 340,
      "operatingExpense": 325,
      "nonoperatingExpense": 7
    },
    "2021": {
      "currentAssets": 407,
      "noncurrentAssets": 407,
      "currentLiabilities": 156,
      "noncurrentLiabilities": 234,
      "revenue": 380,
      "operatingExpense": 358,
      "nonoperatingExpense": 8
    },
    "2022": {
      "currentAssets": 422,
      "noncurrentAssets": 422,
      "currentLiabilities": 160,
      "noncurrentLiabilities": 240,
      "revenue": 450,
      "operatingExpense": 420,
      "nonoperatingExpense": 10
    },
    "2023": {
      "currentAssets": 452,
      "noncurrentAssets": 451,
      "currentLiabilities": 166,
      "noncurrentLiabilities": 249,
      "revenue": 620,
      "operatingExpense": 565,
      "nonoperatingExpense": 15
    },
    "2024": {
      "currentAssets": 2768,
      "noncurrentAssets": 2767,
      "currentLiabilities": 786,
      "noncurrentLiabilities": 1178,
      "revenue": 5800,
      "operatingExpense": 3900,
      "nonoperatingExpense": 400
    },
    "2025": {
      "currentAssets": 3784,
      "noncurrentAssets": 3783,
      "currentLiabilities": 1225,
      "noncurrentLiabilities": 1838,
      "revenue": 4100,
      "operatingExpense": 3320,
      "nonoperatingExpense": 190
    }
  },
  "S11": {
    "2020": {
      "currentAssets": 2590,
      "noncurrentAssets": 2590,
      "currentLiabilities": 952,
      "noncurrentLiabilities": 1428,
      "revenue": 3100,
      "operatingExpense": 2820,
      "nonoperatingExpense": 70
    },
    "2021": {
      "currentAssets": 2730,
      "noncurrentAssets": 2730,
      "currentLiabilities": 984,
      "noncurrentLiabilities": 1476,
      "revenue": 3600,
      "operatingExpense": 3240,
      "nonoperatingExpense": 90
    },
    "2022": {
      "currentAssets": 2967,
      "noncurrentAssets": 2966,
      "currentLiabilities": 1040,
      "noncurrentLiabilities": 1560,
      "revenue": 4500,
      "operatingExpense": 3980,
      "nonoperatingExpense": 120
    },
    "2023": {
      "currentAssets": 3246,
      "noncurrentAssets": 3246,
      "currentLiabilities": 1104,
      "noncurrentLiabilities": 1657,
      "revenue": 5200,
      "operatingExpense": 4560,
      "nonoperatingExpense": 140
    },
    "2024": {
      "currentAssets": 3675,
      "noncurrentAssets": 3674,
      "currentLiabilities": 1210,
      "noncurrentLiabilities": 1816,
      "revenue": 6400,
      "operatingExpense": 5550,
      "nonoperatingExpense": 180
    },
    "2025": {
      "currentAssets": 3980,
      "noncurrentAssets": 3980,
      "currentLiabilities": 1333,
      "noncurrentLiabilities": 1999,
      "revenue": 6100,
      "operatingExpense": 5380,
      "nonoperatingExpense": 160
    }
  },
  "S12": {
    "2020": {
      "currentAssets": 850,
      "noncurrentAssets": 850,
      "currentLiabilities": 280,
      "noncurrentLiabilities": 420,
      "revenue": 980,
      "operatingExpense": 870,
      "nonoperatingExpense": 30
    },
    "2021": {
      "currentAssets": 977,
      "noncurrentAssets": 977,
      "currentLiabilities": 308,
      "noncurrentLiabilities": 462,
      "revenue": 1450,
      "operatingExpense": 1220,
      "nonoperatingExpense": 50
    },
    "2022": {
      "currentAssets": 1059,
      "noncurrentAssets": 1058,
      "currentLiabilities": 327,
      "noncurrentLiabilities": 491,
      "revenue": 1620,
      "operatingExpense": 1360,
      "nonoperatingExpense": 60
    },
    "2023": {
      "currentAssets": 490,
      "noncurrentAssets": 489,
      "currentLiabilities": 172,
      "noncurrentLiabilities": 257,
      "revenue": 1100,
      "operatingExpense": 1180,
      "nonoperatingExpense": 40
    },
    "2024": {
      "currentAssets": 1209,
      "noncurrentAssets": 1208,
      "currentLiabilities": 384,
      "noncurrentLiabilities": 577,
      "revenue": 1750,
      "operatingExpense": 1460,
      "nonoperatingExpense": 60
    },
    "2025": {
      "currentAssets": 1475,
      "noncurrentAssets": 1475,
      "currentLiabilities": 433,
      "noncurrentLiabilities": 650,
      "revenue": 2600,
      "operatingExpense": 2040,
      "nonoperatingExpense": 110
    }
  },
  "S13": {
    "2020": null,
    "2021": null,
    "2022": {
      "currentAssets": 263,
      "noncurrentAssets": 262,
      "currentLiabilities": 126,
      "noncurrentLiabilities": 189,
      "revenue": 420,
      "operatingExpense": 600,
      "nonoperatingExpense": 30
    },
    "2023": {
      "currentAssets": 338,
      "noncurrentAssets": 338,
      "currentLiabilities": 168,
      "noncurrentLiabilities": 253,
      "revenue": 510,
      "operatingExpense": 630,
      "nonoperatingExpense": 30
    },
    "2024": {
      "currentAssets": 468,
      "noncurrentAssets": 468,
      "currentLiabilities": 218,
      "noncurrentLiabilities": 328,
      "revenue": 780,
      "operatingExpense": 810,
      "nonoperatingExpense": 15
    },
    "2025": {
      "currentAssets": 909,
      "noncurrentAssets": 908,
      "currentLiabilities": 381,
      "noncurrentLiabilities": 571,
      "revenue": 1450,
      "operatingExpense": 1240,
      "nonoperatingExpense": 50
    }
  },
  "S14": {
    "2020": {
      "currentAssets": 585,
      "noncurrentAssets": 584,
      "currentLiabilities": 219,
      "noncurrentLiabilities": 328,
      "revenue": 640,
      "operatingExpense": 600,
      "nonoperatingExpense": 12
    },
    "2021": {
      "currentAssets": 911,
      "noncurrentAssets": 910,
      "currentLiabilities": 300,
      "noncurrentLiabilities": 450,
      "revenue": 2100,
      "operatingExpense": 1720,
      "nonoperatingExpense": 80
    },
    "2022": {
      "currentAssets": 462,
      "noncurrentAssets": 461,
      "currentLiabilities": 189,
      "noncurrentLiabilities": 284,
      "revenue": 900,
      "operatingExpense": 1050,
      "nonoperatingExpense": 40
    },
    "2023": {
      "currentAssets": 312,
      "noncurrentAssets": 312,
      "currentLiabilities": 154,
      "noncurrentLiabilities": 230,
      "revenue": 480,
      "operatingExpense": 690,
      "nonoperatingExpense": 40
    },
    "2024": {
      "currentAssets": 289,
      "noncurrentAssets": 289,
      "currentLiabilities": 147,
      "noncurrentLiabilities": 221,
      "revenue": 420,
      "operatingExpense": 510,
      "nonoperatingExpense": 30
    },
    "2025": {
      "currentAssets": 745,
      "noncurrentAssets": 745,
      "currentLiabilities": 374,
      "noncurrentLiabilities": 560,
      "revenue": 510,
      "operatingExpense": 500,
      "nonoperatingExpense": 5
    }
  },
  "S15": {
    "2020": {
      "currentAssets": 3770,
      "noncurrentAssets": 3770,
      "currentLiabilities": 1976,
      "noncurrentLiabilities": 2964,
      "revenue": 5200,
      "operatingExpense": 5580,
      "nonoperatingExpense": 70
    },
    "2021": {
      "currentAssets": 3387,
      "noncurrentAssets": 3386,
      "currentLiabilities": 1849,
      "noncurrentLiabilities": 2774,
      "revenue": 4300,
      "operatingExpense": 4820,
      "nonoperatingExpense": 80
    },
    "2022": {
      "currentAssets": 3660,
      "noncurrentAssets": 3660,
      "currentLiabilities": 1968,
      "noncurrentLiabilities": 2952,
      "revenue": 4800,
      "operatingExpense": 4950,
      "nonoperatingExpense": 70
    },
    "2023": {
      "currentAssets": 4479,
      "noncurrentAssets": 4479,
      "currentLiabilities": 2326,
      "noncurrentLiabilities": 3489,
      "revenue": 5600,
      "operatingExpense": 5420,
      "nonoperatingExpense": 70
    },
    "2024": {
      "currentAssets": 4727,
      "noncurrentAssets": 4727,
      "currentLiabilities": 2327,
      "noncurrentLiabilities": 3491,
      "revenue": 7100,
      "operatingExpense": 6480,
      "nonoperatingExpense": 140
    },
    "2025": {
      "currentAssets": 5066,
      "noncurrentAssets": 5066,
      "currentLiabilities": 2563,
      "noncurrentLiabilities": 3844,
      "revenue": 6300,
      "operatingExpense": 6020,
      "nonoperatingExpense": 90
    }
  },
  "S16": {
    "2020": {
      "currentAssets": 19,
      "noncurrentAssets": 18,
      "currentLiabilities": 6,
      "noncurrentLiabilities": 8,
      "revenue": 45,
      "operatingExpense": 165,
      "nonoperatingExpense": 10
    },
    "2021": {
      "currentAssets": 27,
      "noncurrentAssets": 26,
      "currentLiabilities": 9,
      "noncurrentLiabilities": 14,
      "revenue": 60,
      "operatingExpense": 240,
      "nonoperatingExpense": 15
    },
    "2022": {
      "currentAssets": 45,
      "noncurrentAssets": 45,
      "currentLiabilities": 19,
      "noncurrentLiabilities": 28,
      "revenue": 85,
      "operatingExpense": 325,
      "nonoperatingExpense": 20
    },
    "2023": {
      "currentAssets": 48,
      "noncurrentAssets": 47,
      "currentLiabilities": 24,
      "noncurrentLiabilities": 36,
      "revenue": 70,
      "operatingExpense": 350,
      "nonoperatingExpense": 20
    },
    "2024": {
      "currentAssets": 51,
      "noncurrentAssets": 50,
      "currentLiabilities": 29,
      "noncurrentLiabilities": 44,
      "revenue": 55,
      "operatingExpense": 305,
      "nonoperatingExpense": 20
    },
    "2025": {
      "currentAssets": 48,
      "noncurrentAssets": 48,
      "currentLiabilities": 30,
      "noncurrentLiabilities": 46,
      "revenue": 40,
      "operatingExpense": 250,
      "nonoperatingExpense": 20
    }
  },
  "S17": {
    "2020": {
      "currentAssets": 209,
      "noncurrentAssets": 209,
      "currentLiabilities": 91,
      "noncurrentLiabilities": 137,
      "revenue": 380,
      "operatingExpense": 520,
      "nonoperatingExpense": 20
    },
    "2021": {
      "currentAssets": 523,
      "noncurrentAssets": 523,
      "currentLiabilities": 240,
      "noncurrentLiabilities": 361,
      "revenue": 890,
      "operatingExpense": 1110,
      "nonoperatingExpense": 30
    },
    "2022": {
      "currentAssets": 844,
      "noncurrentAssets": 844,
      "currentLiabilities": 405,
      "noncurrentLiabilities": 608,
      "revenue": 1350,
      "operatingExpense": 1530,
      "nonoperatingExpense": 30
    },
    "2023": {
      "currentAssets": 853,
      "noncurrentAssets": 852,
      "currentLiabilities": 558,
      "noncurrentLiabilities": 837,
      "revenue": 620,
      "operatingExpense": 1510,
      "nonoperatingExpense": 210
    },
    "2024": {
      "currentAssets": 825,
      "noncurrentAssets": 825,
      "currentLiabilities": 440,
      "noncurrentLiabilities": 660,
      "revenue": 1100,
      "operatingExpense": 1250,
      "nonoperatingExpense": 30
    },
    "2025": {
      "currentAssets": 821,
      "noncurrentAssets": 821,
      "currentLiabilities": 371,
      "noncurrentLiabilities": 557,
      "revenue": 1900,
      "operatingExpense": 1840,
      "nonoperatingExpense": 30
    }
  },
  "S18": {
    "2020": {
      "currentAssets": 226830,
      "noncurrentAssets": 226829,
      "currentLiabilities": 64390,
      "noncurrentLiabilities": 96586,
      "revenue": 486000,
      "operatingExpense": 454000,
      "nonoperatingExpense": 8000
    },
    "2021": {
      "currentAssets": 236011,
      "noncurrentAssets": 236011,
      "currentLiabilities": 65404,
      "noncurrentLiabilities": 98107,
      "revenue": 512000,
      "operatingExpense": 474000,
      "nonoperatingExpense": 9000
    },
    "2022": {
      "currentAssets": 244477,
      "noncurrentAssets": 244476,
      "currentLiabilities": 66057,
      "noncurrentLiabilities": 99086,
      "revenue": 561000,
      "operatingExpense": 516000,
      "nonoperatingExpense": 11000
    },
    "2023": {
      "currentAssets": 256667,
      "noncurrentAssets": 256666,
      "currentLiabilities": 72000,
      "noncurrentLiabilities": 108000,
      "revenue": 528000,
      "operatingExpense": 497000,
      "nonoperatingExpense": 8000
    },
    "2024": {
      "currentAssets": 264706,
      "noncurrentAssets": 264706,
      "currentLiabilities": 70588,
      "noncurrentLiabilities": 105883,
      "revenue": 589000,
      "operatingExpense": 542000,
      "nonoperatingExpense": 11000
    },
    "2025": {
      "currentAssets": 282204,
      "noncurrentAssets": 282203,
      "currentLiabilities": 73220,
      "noncurrentLiabilities": 109831,
      "revenue": 642000,
      "operatingExpense": 584000,
      "nonoperatingExpense": 13000
    }
  }
}

// 거시경제 시황. 연도별 지표(현재 라운드 연도 초과분은 스포일러라 화면에서 가린다).
export const MACRO = {
  "2020": {
    "summary": "코로나 충격으로 경기 급랭 — 초저금리·유가 폭락",
    "kospi": 2300,
    "sp500": 3100,
    "nikkei": 23000,
    "europe": 3300,
    "rate": 0.5,
    "cpi": 0.5,
    "oil": 42,
    "gold": 1900
  },
  "2021": {
    "summary": "경기 반등·유동성 장세 — 성장주 급등",
    "kospi": 3200,
    "sp500": 4300,
    "nikkei": 28000,
    "europe": 4300,
    "rate": 0.75,
    "cpi": 2.5,
    "oil": 68,
    "gold": 1800
  },
  "2022": {
    "summary": "인플레이션 급등, 금리 인상 시작 — 성장주 조정",
    "kospi": 2400,
    "sp500": 3600,
    "nikkei": 26000,
    "europe": 3800,
    "rate": 3.25,
    "cpi": 5.1,
    "oil": 95,
    "gold": 1850
  },
  "2023": {
    "summary": "고금리 지속·경기 둔화 — 실적 옥석 가리기",
    "kospi": 2600,
    "sp500": 4200,
    "nikkei": 33000,
    "europe": 4500,
    "rate": 3.5,
    "cpi": 3.6,
    "oil": 78,
    "gold": 2000
  },
  "2024": {
    "summary": "금리 인하 기대·완만한 회복",
    "kospi": 2800,
    "sp500": 5100,
    "nikkei": 38000,
    "europe": 4900,
    "rate": 3,
    "cpi": 2.3,
    "oil": 80,
    "gold": 2600
  },
  "2025": {
    "summary": "금리 정상화·안정 국면",
    "kospi": 2900,
    "sp500": 5400,
    "nikkei": 39000,
    "europe": 5100,
    "rate": 2.5,
    "cpi": 2,
    "oil": 72,
    "gold": 2750
  }
}
