// 관리자용 "친근한 손잡이" — 세그먼트(나쁨/보통/좋음)를 고르면 매크로 여러 개를 한 번에 세팅.
// 세그먼트는 setter일 뿐이다. 지금 선택 상태는 정확히 일치하는 레벨을 찾고, 없으면 "커스텀"(정밀 조정됨).
// 실제 숫자는 세그먼트 아래 작게 병기한다(친근함 + 투명성).

export const MACRO_DIALS = [
  {
    key: 'cycle',
    label: '경기',
    levels: [
      { id: 'crash', label: '매우 나쁨', macro: { gdp: -2, unemp: 7, sent: 20 } },
      { id: 'bad', label: '나쁨', macro: { gdp: 0, unemp: 5, sent: 38 } },
      { id: 'ok', label: '보통', macro: { gdp: 3, unemp: 3, sent: 50 } },
      { id: 'good', label: '좋음', macro: { gdp: 5, unemp: 2.5, sent: 62 } },
      { id: 'boom', label: '매우 좋음', macro: { gdp: 7, unemp: 2, sent: 75 } },
    ],
    fmt: (m) => `GDP ${m.gdp}% · 실업 ${m.unemp}% · 심리 ${m.sent}`,
  },
  {
    key: 'rates',
    label: '금리·물가',
    levels: [
      { id: 'ease', label: '완화', macro: { int_r: 1, inf: 1 } },
      { id: 'neutral', label: '중립', macro: { int_r: 2, inf: 2 } },
      { id: 'tight', label: '긴축', macro: { int_r: 4, inf: 4 } },
      { id: 'shock', label: '급긴축', macro: { int_r: 5.5, inf: 7 } },
    ],
    fmt: (m) => `금리 ${m.int_r}% · 물가 ${m.inf}%`,
  },
  {
    key: 'external',
    label: '대외 여건',
    levels: [
      { id: 'calm', label: '안정', macro: { fx: 1300, oil: 75 } },
      { id: 'strain', label: '부담', macro: { fx: 1450, oil: 100 } },
      { id: 'shock', label: '충격', macro: { fx: 1550, oil: 120 } },
    ],
    fmt: (m) => `환율 ${m.fx} · 유가 ${m.oil}`,
  },
]

/** 세 손잡이 레벨 id → 완전한 macro 7요인. 프리셋을 세그먼트에 딱 맞게 정의할 때 쓴다. */
export function macroFromLevels({ cycle = 'ok', rates = 'neutral', external = 'calm' } = {}) {
  const lv = (key, id) => {
    const d = MACRO_DIALS.find((x) => x.key === key)
    return (d.levels.find((l) => l.id === id) ?? d.levels[Math.floor(d.levels.length / 2)]).macro
  }
  return { ...lv('cycle', cycle), ...lv('rates', rates), ...lv('external', external) }
}

/** 현재 macro가 그 dial의 어느 레벨과 정확히 일치하나? 없으면 null(= 커스텀/정밀 조정됨). */
export function activeLevelId(dial, macro) {
  const hit = dial.levels.find((lv) => Object.entries(lv.macro).every(([k, v]) => Number(macro[k]) === v))
  return hit?.id ?? null
}

/** 한 분기 macro → 세 손잡이 요약 라벨(요약 스트립용). 다 커스텀이면 "커스텀". */
export function quarterMood(macro) {
  const parts = MACRO_DIALS.map((d) => {
    const id = activeLevelId(d, macro)
    return id ? d.levels.find((l) => l.id === id).label : null
  })
  return parts[0] ?? '커스텀' // 경기 라벨을 대표로. 전부 null이면 커스텀.
}
