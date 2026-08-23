import Modal from './Modal'
import { num, signed, pct, dirOf } from '../format'

/**
 * 전체 조 순위 팝업. 헤더의 순위 배지를 누르면 열린다.
 * @param {{rank:number, name:string, equity:number, pnl:number, pnlPct:number, me:boolean}[]} rows
 */
export default function RankingModal({ open, onClose, rows }) {
  return (
    <Modal open={open} onClose={onClose} title="조별 순위" wide>
      <p className="mock-note">순위는 강사 선생님이 다음 연도로 넘길 때 갱신돼요.</p>

      {rows.length === 0 ? (
        <p className="tbl-empty">아직 참가한 조가 없어요.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>순위</th>
              <th>조</th>
              <th>평가금액</th>
              <th>수익률</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.name} className={t.me ? 'me-row' : ''}>
                <td className="num">{t.rank}</td>
                <td>
                  {t.name}
                  {t.me && <span className="me-tag">내 조</span>}
                </td>
                <td className="num">{num(t.equity)}</td>
                <td className={'num ' + dirOf(t.pnl)}>
                  {pct(t.pnlPct)}
                  <div className="sub" style={{ color: 'inherit' }}>
                    {signed(t.pnl)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  )
}
