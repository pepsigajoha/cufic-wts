// 거래 상태 스트립 — "지금 매매할 수 있나?"를 한 문장으로 알려준다. 헤더 아래 전폭.
// 옛 `.notstarted` 배너 + OrderSheet 안에만 있던 "거래 대기" 안내를 한 곳으로 모은 것.
// state는 App이 이미 파생한 값(started·ended·timerState)만 조합해 넘긴다 — 여기서 새 상태를 만들지 않는다.
//   before  : 대회 시작 전(R0)
//   waiting : 라운드는 열렸지만 타이머 꺼짐
//   live    : 거래 중
//   paused  : 일시정지(0049)
//   closed  : 타이머 만료 — 다음 안내 대기
//   ended   : 대회 종료

const MSG = {
  before: ['●', '대회 시작을 기다리는 중이에요 — 선생님이 첫 라운드를 열면 시작돼요'],
  waiting: ['●', '거래 대기 — 선생님이 타이머를 시작하면 매수·매도할 수 있어요'],
  live: ['▶', '지금 거래 중이에요 — 매수·매도할 수 있어요'],
  paused: ['⏸', '거래 일시정지 — 잠시만 기다려 주세요'],
  closed: ['■', '이번 거래 시간이 끝났어요 — 다음 안내를 기다려 주세요'],
  ended: ['🏁', '대회가 끝났어요 — 최종 결과를 확인하세요'],
}

export default function TradeStatusStrip({ state = 'before' }) {
  const [icon, text] = MSG[state] ?? MSG.before
  return (
    // role=status → 상태가 바뀌면 스크린리더가 읽어준다. 색·굵기만으로 전달하지 않도록 아이콘+문장을 함께 둔다.
    <div className={'trade-strip ts-' + state} role="status">
      <span className="ts-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="ts-text">{text}</span>
    </div>
  )
}
