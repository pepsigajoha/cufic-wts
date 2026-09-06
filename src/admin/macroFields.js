// 거시 7요인 슬라이더 UI 메타(라벨·범위·스텝). "지금 라운드용 거시 파라미터" 카드와
// "분기별 파라미터" 카드가 같은 정의를 쓰도록 한곳에 둔다. key는 priceSim.defaultMacro()와 동일.
// group: 'main' = 분기 그리드에 기본 노출 / 'adv' = "고급 ▾"로 접어둠.
export const MACRO_FIELDS = [
  { key: 'int_r', label: '기준금리 (%)', short: '금리', min: 0, max: 10, step: 0.25, group: 'main' },
  { key: 'gdp', label: 'GDP 성장률 (%)', short: 'GDP', min: -5, max: 15, step: 0.5, group: 'main' },
  { key: 'sent', label: '소비심리 지수', short: '소비심리', min: 0, max: 100, step: 1, group: 'main' },
  { key: 'unemp', label: '실업률 (%)', short: '실업', min: 1, max: 15, step: 0.1, group: 'adv' },
  { key: 'inf', label: '물가상승률 CPI (%)', short: '물가', min: -2, max: 20, step: 0.5, group: 'adv' },
  { key: 'fx', label: '원/달러 환율 (원)', short: '환율', min: 1000, max: 1800, step: 10, group: 'adv' },
  { key: 'oil', label: '국제유가 ($)', short: '유가', min: 20, max: 160, step: 1, group: 'adv' },
]

export const MACRO_KEYS = MACRO_FIELDS.map((f) => f.key)
export const MACRO_MAIN = MACRO_FIELDS.filter((f) => f.group === 'main')
export const MACRO_ADV = MACRO_FIELDS.filter((f) => f.group === 'adv')
