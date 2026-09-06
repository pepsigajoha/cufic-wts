import { PRNG } from './priceSim'

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
