// 장중 분기 전환(Q1→Q2, Q2→Q3, Q3→Q4) 시 학생 화면에 띄우는 속보/힌트 — 임시 클라이언트 config.
//
// [왜 여기 있나] 분기 스케줄을 anon이 읽을 DB 저장소가 아직 없다(마이그레이션 대기). 그때까지의
// 자리표시자다. 관리자가 AdminSimulator "분기별 파라미터" 카드에 입력한 속보/힌트는 그 관리자
// 브라우저 sessionStorage에만 있어 학생 화면에서 못 읽는다 — 여기 기본 문구로 대체한다.
//
// [덮어쓰기] 시연·테스트 중엔 학생 브라우저 콘솔에서
//   sessionStorage.setItem('wts-quarter-events', JSON.stringify({ "2": {news:"...", hint:"..."} }))
// 또는 라운드별로  { "<round>": { "2": {news, hint} } }  형태를 넣으면 그 값이 우선한다.

const OVERRIDE_KEY = 'wts-quarter-events'

const DEFAULTS = {
  2: { news: '2분기 진입 — 시장 흐름이 바뀔 수 있어요. 재무제표와 시황을 다시 확인해 보세요.', hint: '' },
  3: { news: '3분기 진입 — 상반기 실적이 반영됐어요. 보유 종목의 방향을 점검하세요.', hint: '' },
  4: { news: '4분기 진입 — 연말 마감이 가까워요. 마지막 조정 기회입니다.', hint: '' },
}

/**
 * @param {number} round     현재 라운드(current_round)
 * @param {number} quarter   진입한 분기(2|3|4)
 * @returns {{news?:string, hint?:string}|null}
 */
export function quarterEvent(round, quarter) {
  try {
    const raw = JSON.parse(sessionStorage.getItem(OVERRIDE_KEY) || '{}')
    const byRound = raw && typeof raw === 'object' ? raw[String(round)] : null
    const hit = (byRound && byRound[String(quarter)]) || raw[String(quarter)]
    if (hit && (hit.news || hit.hint)) return hit
  } catch {
    /* 잘못된 JSON 등은 무시하고 기본값으로 */
  }
  return DEFAULTS[quarter] ?? null
}
