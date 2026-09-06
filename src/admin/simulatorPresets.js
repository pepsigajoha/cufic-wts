import { PRNG } from './priceSim'
import { macroFromLevels } from './macroLevels'

// 프리셋: 7요인을 한 번에 채운다. fx/oil은 종목마다 다른 베타로 반응하므로
// "훈풍/역풍"이 아니라 섹터별로 희비가 갈리는 충격으로 이해해야 한다.
// AdminSimulator.jsx(전체 탭)와 FloatingRoundDock.jsx(빠른 생성)가 같은 시나리오를 쓴다.
export const PRESETS = [
  { key: 'growth', label: '정상 성장', unemp: 3.0, gdp: 4.0, int_r: 2.0, inf: 2.0, sent: 60, fx: 1300, oil: 75 },
  {
    key: 'stagflation',
    label: '스태그플레이션 위기',
    unemp: 6.0,
    gdp: -1.5,
    int_r: 5.5,
    inf: 8.5,
    sent: 28,
    fx: 1550,
    oil: 120,
  },
  {
    key: 'commodity',
    label: '원자재·환율 충격 (섹터별 희비 갈림)',
    unemp: 3.2,
    gdp: 3.5,
    int_r: 2.5,
    inf: 2.5,
    sent: 60,
    fx: 1550,
    oil: 120,
  },
]

// 분기별(63거래일) 거시 시나리오 프리셋 — 세 손잡이(경기/금리·물가/대외)의 레벨 id로 정의한다.
// 그래야 불러왔을 때 세그먼트가 딱 맞게 켜지고 요약 스트립도 "나쁨/좋음"으로 읽힌다.
// cycle: crash|bad|ok|good|boom · rates: ease|neutral|tight|shock · external: calm|strain|shock
const q = (quarter, levels, eventNews = '', hintText = '') => ({
  quarter,
  macro: macroFromLevels(levels),
  eventNews,
  hintText,
})

export const QUARTER_PRESETS = [
  {
    key: 'steady-growth',
    label: '완만한 성장장',
    quarters: [q(1, { cycle: 'ok' }), q(2, { cycle: 'good' }), q(3, { cycle: 'good' }), q(4, { cycle: 'good' })],
  },
  {
    key: 'q2-crisis-q4-rebound',
    label: '2분기 금융위기 충격 · 4분기 반등',
    quarters: [
      q(1, { cycle: 'ok', rates: 'tight' }),
      q(2, { cycle: 'crash', rates: 'shock', external: 'shock' }, '금리 급등·경기 침체 — 시장 전반 급락'),
      q(3, { cycle: 'bad', rates: 'tight', external: 'strain' }),
      q(4, { cycle: 'good', rates: 'neutral' }, '정책 대응에 반등 국면 진입'),
    ],
  },
  {
    key: 'box-range',
    label: '박스권 횡보장',
    quarters: [q(1, { cycle: 'bad' }), q(2, { cycle: 'ok' }), q(3, { cycle: 'bad' }), q(4, { cycle: 'ok' })],
  },
  {
    key: 'slow-bear',
    label: '완만한 하락장',
    quarters: [
      q(1, { cycle: 'ok', rates: 'tight' }),
      q(2, { cycle: 'bad', rates: 'tight' }),
      q(3, { cycle: 'bad', rates: 'tight' }),
      q(4, { cycle: 'bad', rates: 'neutral' }),
    ],
  },
]

// 종목별 UI가 없으므로, 시드값으로부터 환율·유가 민감도(섹터 베타)를 결정적으로 만든다.
// 같은 시드 + 같은 종목 수 → 항상 같은 베타(재현 가능).
export function deriveSectorBetas(seed, n) {
  const rngFx = new PRNG((seed + 911001) >>> 0)
  const rngOil = new PRNG((seed + 911002) >>> 0)
  const round1 = (v) => Math.round(v * 10) / 10
  return {
    betaFx: Array.from({ length: n }, () => round1(rngFx.uniform() * 2 - 1)),
    betaOil: Array.from({ length: n }, () => round1(rngOil.uniform() * 2 - 1)),
  }
}
