import Modal from './Modal'
import { num, signed, pct, dirOf } from '../format'

/**
 * 대회 종료 모달. [대회 종료] 시 전 학생 화면에 자동으로 뜬다(또는 종료 후 접속 시).
 * 내 최종 성적 + 전체 조 순위(final_year 가격 기준)를 한 번에 보여준다.
 *
 * @param {{rank:number, name:string, equity:number, pnl:number, pnlPct:number, me:boolean}[]} rows
 */
export default function FinalModal({ open, onClose, account, rows, finalYear }) {
  const me = rows.find((r) => r.me)

  return (
    <Modal open={open} onClose={onClose} title="🏁 대회 종료" wide>
      <p className="mock-note">
        {finalYear ? `${finalYear}년 가격으로 최종 정산했어요.` : '최종 정산 결과예요.'} 수고했어요!
      </p>

      <div className="sumbar">
        <div className="cell">
          <span className="k">내 최종 순위</span>
          <span className="v num">
            {me ? `${me.rank}위` : '-'}
            {me?.prevRank != null && me.prevRank !== me.rank && (
              <span className={'rk-move ' + (me.rank < me.prevRank ? 'up' : 'down')}>
                {me.rank < me.prevRank ? `▲${me.prevRank - me.rank}` : `▼${me.rank - me.prevRank}`}
              </span>
            )}
          </span>
        </div>
        <div className="cell">
          <span className="k">최종 자산</span>
          <span className="v num">₩ {num(account.equity)}</span>
        </div>
        <div className="cell">
          <span className="k">총 수익률</span>
          <span className={'v num ' + dirOf(account.pnl)}>
            {signed(account.pnl)}
            <span style={{ fontSize: 12, marginLeft: 4 }}>({pct(account.pnlPct)})</span>
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="tbl-empty">참가한 조가 없어요.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>순위</th>
              <th>조</th>
              <th>최종 자산</th>
              <th>수익률</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.name} className={t.me ? 'me-row' : ''}>
                <td className="num">
                  {t.rank}
                  {t.prevRank != null && t.prevRank !== t.rank && (
                    <span className={'rk-move ' + (t.rank < t.prevRank ? 'up' : 'down')}>
                      {t.rank < t.prevRank ? `▲${t.prevRank - t.rank}` : `▼${t.rank - t.prevRank}`}
                    </span>
                  )}
                </td>
                <td>
                  {t.name}
                  {t.me && <span className="me-tag">내 조</span>}
                </td>
                <td className="num">{num(t.equity)}</td>
                <td className={'num ' + dirOf(t.pnl)}>{pct(t.pnlPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mfoot">
        <button className="act-btn prime" onClick={onClose} autoFocus>
          확인
        </button>
      </div>
    </Modal>
  )
}
