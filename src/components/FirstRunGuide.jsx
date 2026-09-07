import Modal from './Modal'

// 처음 입장한 학생에게 화면 흐름을 한 번만 보여준다(localStorage 'wts-seen-guide').
// 요소마다 스포트라이트를 씌우는 대신 — DOM 위치에 얽매이면 잘 깨진다 — 흐름을 짧게 설명한다.
const STEPS = [
  ['종목 고르기', '왼쪽 목록에서 관심 있는 종목을 눌러요.'],
  ['차트 보기', '가운데에서 그 종목의 가격 흐름을 확인해요.'],
  ['근거 확인', '차트 아래 [재무 요약 · 시황 요약 · 힌트]로 판단 근거를 봐요.'],
  ['주문', '오른쪽에서 수량을 정하고 매수 / 매도를 눌러요. 누르는 즉시 체결돼요.'],
]

export default function FirstRunGuide({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title="처음이라면 — 30초 안내">
      <ol className="frg-steps">
        {STEPS.map(([t, d], i) => (
          <li key={i} className="frg-step">
            <span className="frg-n">{i + 1}</span>
            <div>
              <b>{t}</b>
              <p>{d}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="frg-note">
        거래는 <b>선생님이 타이머를 연 동안에만</b> 할 수 있어요. 연도가 바뀌면 가격과 순위가 움직여요.
      </p>
      <button className="act-btn buy frg-go" onClick={onClose}>
        시작하기
      </button>
    </Modal>
  )
}
