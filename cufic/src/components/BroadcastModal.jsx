import Modal from './Modal'
import { yearOf } from '../gameData'

/**
 * 속보(공통 힌트) 팝업. 강사가 전체 조에 보낸 한 줄 알림을 최신순으로 보여준다.
 * 조별 등급 힌트(HintModal)와 달리 전원에게 같은 내용이 뜬다.
 */
const hhmm = (iso) => {
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function BroadcastModal({ open, onClose, broadcasts, game }) {
  return (
    <Modal open={open} onClose={onClose} title="📢 속보" wide>
      {broadcasts.length === 0 ? (
        <p className="bc-empty">
          아직 도착한 속보가 없어요. 강사 선생님이 속보를 보내면 여기에 나타나요.
        </p>
      ) : (
        <div className="bc-list">
          {broadcasts.map((b) => {
            const y = yearOf(game, b.round)
            return (
              <div key={b.id} className="bc-item">
                <div className="bc-meta">
                  {b.round >= 1 ? `R${b.round}${y ? ` · ${y}년` : ''} · ` : ''}
                  {hhmm(b.created_at)}
                </div>
                <p className="bc-head">{b.headline}</p>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
