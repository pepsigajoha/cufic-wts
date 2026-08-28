import { defaultMacro } from './priceSim'

// 규칙 기반 "시장 속보" 후보 생성기. 여러 조건이 동시에 걸리면 후보가 여러 개 나올 수 있다
// (예: 고금리+고유가가 겹치면 두 헤드라인 다 후보에 오른다). 하나도 안 걸리면 "특이사항 없음"
// 하나만 낸다. 임계값은 임의로 정한 값이라 실사용 데이터로 다시 조정할 여지가 있다.
const RULES = [
  {
    key: 'tightening',
    test: (m) => m.int_r >= 4.5 || m.inf >= 6.0,
    headline: '중앙은행 긴축 단행',
    body: (m, delta) =>
      `기준금리 ${m.int_r.toFixed(2)}%${delta('int_r', '%p')}·물가상승률 ${m.inf.toFixed(1)}%${delta('inf', '%p')} — ` +
      '고금리 여파로 기술·성장주에 하방 압력이 가해지는 가운데, 금융주는 상대적으로 선방하고 있습니다.',
    sectors: ['IT/가전', '금융'],
    impact: 'down',
  },
  {
    key: 'oil-shock',
    test: (m) => m.oil >= 100,
    headline: '국제유가 급등 쇼크',
    body: (m, delta) =>
      `국제유가 ${m.oil.toFixed(0)}달러 돌파${delta('oil', '달러')} — ` +
      '정유·에너지주는 반사이익을 누리는 반면, 항공·물류주는 원가 부담이 심화되고 있습니다.',
    sectors: ['에너지/화학', '운송/항공'],
    impact: 'mixed',
  },
  {
    key: 'fx-shock',
    test: (m) => m.fx >= 1500,
    headline: '원/달러 환율 급등',
    body: (m, delta) =>
      `환율 ${m.fx.toFixed(0)}원${delta('fx', '원')} — ` +
      '수출 대형주에는 호재지만, 내수·수입 소비재 기업은 수익성 악화가 우려됩니다.',
    sectors: ['IT/가전', '자동차/조선', '소비재'],
    impact: 'mixed',
  },
  {
    key: 'boom',
    test: (m) => m.gdp >= 4.0 && m.sent >= 65,
    headline: '경기 회복세 뚜렷',
    body: (m, delta) =>
      `GDP 성장률 ${m.gdp.toFixed(1)}%${delta('gdp', '%p')}·소비심리지수 ${m.sent.toFixed(0)}${delta('sent', '')} — ` +
      '소비재·엔터·플랫폼 전방위 상승세가 나타나고 있습니다.',
    sectors: ['소비재', '엔터/플랫폼'],
    impact: 'up',
  },
]

/**
 * 거시 파라미터에서 규칙 기반으로 "시장 속보" 후보 배열을 만든다.
 * @param {object} currentMacro 이번 라운드에 적용할 7요인 매크로
 * @param {object|null} prevMacro 직전 라운드 매크로(있으면 변화량을 한 줄 덧붙인다)
 * @param {number} round 안내 문구에 쓸 라운드 번호(특이사항 없음일 때만 쓰임)
 * @returns {Array<{key,headline,body,sectors,impact}>}
 */
export function generateMacroNews(currentMacro, prevMacro, round) {
  const m = { ...defaultMacro(), ...currentMacro }
  const p = prevMacro ? { ...defaultMacro(), ...prevMacro } : null

  const delta = (key, unit = '') => {
    if (!p) return ''
    const d = m[key] - p[key]
    if (Math.abs(d) < 0.05) return ''
    return ` (전 라운드 대비 ${d > 0 ? '+' : ''}${d.toFixed(1)}${unit})`
  }

  const items = RULES.filter((r) => r.test(m)).map((r) => ({
    key: r.key,
    headline: r.headline,
    body: r.body(m, delta),
    sectors: r.sectors,
    impact: r.impact,
  }))

  if (items.length > 0) return items

  return [
    {
      key: 'calm',
      headline: `${round ?? ''}라운드 시장 특이사항 없음`.trim(),
      body: '거시 지표가 전반적으로 안정적인 범위에서 유지되고 있습니다.',
      sectors: [],
      impact: 'flat',
    },
  ]
}
