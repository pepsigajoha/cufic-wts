// 한국형 업종 분류 + 색상 팔레트.
//
// 실제 라이브 데이터에서 stocks.sector가 비어있는 경우가 많아(자유 입력 필드라 강사가 안 채울
// 수 있음), 차트의 모든 종목이 "기타" 한 그룹·한 색으로 뭉치는 문제가 있었다. sector가 비어있으면
// 종목명 키워드로 업종을 추정해 최대한 실제처럼 갈라 보여준다. 이건 어디까지나 "차트 가독성용
// 추정"이지 종목의 진짜 업종 분류를 자동 확정하는 게 아니다 — 정확한 업종은 여전히
// [종목·가격] 탭에서 sector 필드를 직접 채워야 한다(그 값이 있으면 항상 그걸 우선한다).
const TAXONOMY = [
  { name: 'IT/가전', color: '#2f6feb', keywords: ['전자', '반도체', '테크', 'IT', '소프트', '디지털', '통신'] },
  { name: '금융', color: '#16a34a', keywords: ['보험', '은행', '증권', '캐피탈', '카드', '금융', '자산'] },
  { name: '바이오/제약', color: '#a855f7', keywords: ['바이오', '제약', '헬스', '메디', '병원', '진단'] },
  { name: '에너지/화학', color: '#d97706', keywords: ['에너지', '정유', '화학', '가스', '전력', '태양광', '배터리'] },
  { name: '엔터/플랫폼', color: '#0d9488', keywords: ['엔터', '게임', '플랫폼', '미디어', '콘텐츠', '웹툰'] },
  { name: '소비재', color: '#e11d48', keywords: ['식품', '유통', '리테일', '패션', '뷰티', '홈', '음료'] },
  { name: '운송/항공', color: '#0891b2', keywords: ['항공', '운송', '해운', '물류', '택배'] },
  { name: '자동차/조선', color: '#b45309', keywords: ['자동차', '모터', '조선', '중공업', '부품'] },
]
const FALLBACK_PALETTE = ['#6366f1', '#ca8a04', '#059669', '#db2777', '#7c3aed', '#0284c7']
const OTHER_COLOR = '#6b7280'
const OTHER_NAME = '기타'

/** 종목 하나의 업종명을 정한다: 명시적 sector 필드 → 종목명 키워드 매칭 → '기타'. */
export function classifySector(stock) {
  const explicit = stock?.sector?.trim()
  if (explicit) {
    const known = TAXONOMY.find((t) => t.name === explicit)
    return known ? known.name : explicit // 목록에 없는 이름이면 관리자가 적은 그대로 존중
  }
  const name = stock?.name ?? ''
  const matched = TAXONOMY.find((t) => t.keywords.some((k) => name.includes(k)))
  return matched ? matched.name : OTHER_NAME
}

/** 업종명 목록에 색을 배정한다. 알려진 업종은 고정색, 낯선 업종명은 팔레트 순환, '기타'는 회색. */
export function buildSectorPalette(sectorNames) {
  const map = {}
  let fallbackIdx = 0
  for (const name of sectorNames) {
    const known = TAXONOMY.find((t) => t.name === name)
    if (known) map[name] = known.color
    else if (name === OTHER_NAME) map[name] = OTHER_COLOR
    else {
      map[name] = FALLBACK_PALETTE[fallbackIdx % FALLBACK_PALETTE.length]
      fallbackIdx += 1
    }
  }
  return map
}
