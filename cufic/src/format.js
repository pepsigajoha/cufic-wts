// 숫자 포맷 유틸
export const num = (n) => Math.round(n).toLocaleString('ko-KR')

// 보합(0)에는 부호를 붙이지 않는다 — "+0"·"+0.00%"는 오른 것처럼 읽힌다
export const signed = (n) => (n > 0 ? '+' : '') + num(n)
export const pct = (n) => (n > 0 ? '+' : '') + n.toFixed(2) + '%'

// 방향 클래스 (한국 증시 관례: 상승 빨강 / 하락 파랑 / 보합 중립)
export const dirOf = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat')

// 보합 표시용 기호
export const arrowOf = (n) => (n > 0 ? '▲' : n < 0 ? '▼' : '–')

// 억원 단위 재무 수치. 음수는 마이너스(−)로 표시한다 —
// 회계 관례의 △(삼각형)은 청소년이 '증가'로 오해하기 쉬워, 명확한 부호로 통일했다.
export const eok = (n) => num(n)

// 현재 시각 HH:MM:SS
export const nowTime = () =>
  new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
