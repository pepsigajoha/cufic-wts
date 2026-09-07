// 거시 7요인 슬라이더 UI 메타(라벨·범위·스텝). "지금 라운드용 거시 파라미터" 카드와
// "분기별 파라미터" 카드가 같은 정의를 쓰도록 한곳에 둔다. key는 priceSim.defaultMacro()와 동일.
// group: 'main' = 분기 그리드에 기본 노출 / 'adv' = "고급 ▾"로 접어둠.
// q + levels = "한 흐름" Toss식 설문(한 지표씩 물어봄)에서 쓰는 질문 문장·빠른 선택지.
//   levels[i].v 는 그 선택지가 세팅하는 값. "보통/안정" 값은 priceSim MACRO_BASE 와 일치시켜
//   기본 상태면 설문이 요약부터 뜨게 한다.
export const MACRO_FIELDS = [
  {
    key: 'int_r', label: '기준금리 (%)', short: '금리', min: 0, max: 10, step: 0.25, group: 'main',
    q: '기준금리는 어느 수준일까요?',
    levels: [
      { id: 'ease', label: '완화', v: 1 },
      { id: 'neutral', label: '중립', v: 2 },
      { id: 'tight', label: '긴축', v: 4 },
      { id: 'shock', label: '급긴축', v: 5.5 },
    ],
  },
  {
    key: 'gdp', label: 'GDP 성장률 (%)', short: 'GDP', min: -5, max: 15, step: 0.5, group: 'main',
    q: '경제 성장(GDP)은 어떤가요?',
    levels: [
      { id: 'crash', label: '침체', v: -2 },
      { id: 'slow', label: '둔화', v: 0 },
      { id: 'ok', label: '보통', v: 3 },
      { id: 'grow', label: '성장', v: 5 },
      { id: 'boom', label: '과열', v: 7 },
    ],
  },
  {
    key: 'sent', label: '소비심리 지수', short: '소비심리', min: 0, max: 100, step: 1, group: 'main',
    q: '사람들 소비심리는요?',
    levels: [
      { id: 'panic', label: '침체', v: 20 },
      { id: 'weak', label: '위축', v: 38 },
      { id: 'ok', label: '보통', v: 50 },
      { id: 'warm', label: '온기', v: 62 },
      { id: 'bull', label: '낙관', v: 75 },
    ],
  },
  {
    key: 'unemp', label: '실업률 (%)', short: '실업', min: 1, max: 15, step: 0.1, group: 'adv',
    q: '실업률은 어느 정도인가요?',
    levels: [
      { id: 'full', label: '완전고용', v: 2 },
      { id: 'low', label: '낮음', v: 2.5 },
      { id: 'ok', label: '보통', v: 3 },
      { id: 'high', label: '높음', v: 5 },
      { id: 'crisis', label: '침체', v: 7 },
    ],
  },
  {
    key: 'inf', label: '물가상승률 CPI (%)', short: '물가', min: -2, max: 20, step: 0.5, group: 'adv',
    q: '물가(CPI)는 어떤가요?',
    levels: [
      { id: 'defl', label: '저물가', v: 1 },
      { id: 'stable', label: '안정', v: 2 },
      { id: 'warm', label: '다소 높음', v: 4 },
      { id: 'hot', label: '고물가', v: 7 },
    ],
  },
  {
    key: 'fx', label: '원/달러 환율 (원)', short: '환율', min: 1000, max: 1800, step: 10, group: 'adv',
    q: '원/달러 환율은요?',
    levels: [
      { id: 'strong', label: '강세', v: 1250 },
      { id: 'calm', label: '안정', v: 1300 },
      { id: 'strain', label: '부담', v: 1450 },
      { id: 'shock', label: '충격', v: 1550 },
    ],
  },
  {
    key: 'oil', label: '국제유가 ($)', short: '유가', min: 20, max: 160, step: 1, group: 'adv',
    q: '국제유가는요?',
    levels: [
      { id: 'low', label: '낮음', v: 60 },
      { id: 'calm', label: '안정', v: 75 },
      { id: 'strain', label: '부담', v: 100 },
      { id: 'shock', label: '충격', v: 120 },
    ],
  },
]

export const MACRO_KEYS = MACRO_FIELDS.map((f) => f.key)
export const MACRO_MAIN = MACRO_FIELDS.filter((f) => f.group === 'main')
export const MACRO_ADV = MACRO_FIELDS.filter((f) => f.group === 'adv')

/** 지금 macro[f.key] 가 그 지표의 어느 빠른 선택지와 정확히 일치하나? 없으면 null(직접 조정됨). */
export function fieldLevelId(f, macro) {
  return f.levels?.find((lv) => Number(macro?.[f.key]) === lv.v)?.id ?? null
}
