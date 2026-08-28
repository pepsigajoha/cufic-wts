import { useMemo } from 'react'
import Modal from './Modal'
import { num, signed, pct, dirOf } from '../format'

/**
 * 라운드 전환 요약. 라운드제 게임의 하이라이트 순간이므로 반드시 알린다 —
 * 조용히 12종목 가격만 바뀌면 학생은 무슨 일이 일어났는지 알 수 없다.
 *
 * @param {{round:number, year:number}|null} round  null이면 닫힘
 * @param {number|null} prevEquity  직전 라운드를 떠날 때의 평가금액. 이번 전환으로
 *   내 자산이 얼마나 움직였는지 보여주는 기준. 없으면(첫 전환 등) 원금 대비로 대체.
 */
export default function RoundModal({ round, account, stocks, rows = [], prevEquity, rank, prevRank, teamCount, onClose }) {
  // 시장 전체가 아니라 '내가 들고 있는' 종목의 등락을 보여준다 —
  // 안 산 종목이 올랐다는 정보는 이 순간 학생에게 의미가 없다.
  const { best, worst, delisted } = useMemo(() => {
    const mine = stocks.filter((s) => s.holding > 0 && !s.halted)
    // 보유 중인데 가격 0이 된 종목 = 상장폐지(전액 손실)
    const delisted = stocks.filter((s) => s.holding > 0 && s.halted)
    if (!mine.length) return { best: null, worst: null, delisted }
    const sorted = [...mine].sort((a, b) => b.chg - a.chg)
    return { best: sorted[0], worst: sorted.length > 1 ? sorted[sorted.length - 1] : null, delisted }
  }, [stocks])

  if (!round) return null

  const changed = prevEquity != null
  const delta = changed ? account.equity - prevEquity : account.pnl
  const deltaPct = changed ? (prevEquity ? (delta / prevEquity) * 100 : 0) : account.pnlPct

  return (
    <Modal open onClose={onClose} title={`ROUND ${round.round}`} wide>
      <div className="rsum">
        <p className="year">{round.year}년이 되었습니다</p>
        <p className="sub">주가가 새로 바뀌었어요. 내 자산이 어떻게 됐는지 확인해 보세요.</p>

        <div className="eqbox">
          <span className="k">내 평가금액</span>
          <span className="v num">₩ {num(account.equity)}</span>
          <span className={'d num ' + dirOf(delta)}>
            {changed ? '이번 라운드 변동 ' : '원금 대비 '}
            {signed(delta)} ({pct(deltaPct)})
          </span>
        </div>

        {rank != null && (
          <div className="rankbox">
            <span className="k">내 순위</span>
            <span className="v num">
              {prevRank != null && prevRank !== rank ? `${prevRank}위 → ${rank}위` : `${rank}위`}
              {teamCount ? <span className="of"> / {teamCount}조</span> : null}
            </span>
            {prevRank == null ? null : prevRank !== rank ? (
              <span className={'d ' + (rank < prevRank ? 'up' : 'down')}>
                {rank < prevRank ? `▲${prevRank - rank}` : `▼${rank - prevRank}`}
              </span>
            ) : (
              <span className="d flat">유지</span>
            )}
          </div>
        )}

        {delisted.length > 0 && (
          <div className="delist-warn">
            ⚠ 보유하신 <b>{delisted.map((s) => s.name).join(', ')}</b>이(가) <b>상장폐지</b>되었어요 — 전액 손실.
          </div>
        )}

        {/* 전체 조 순위 — 이 라운드 정산 결과 */}
        {rows.length > 0 && (
          <div className="round-board">
            <span className="rb-cap">전체 순위</span>
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
                    <td className="num">₩ {num(t.equity)}</td>
                    <td className={'num ' + dirOf(t.pnl)}>{pct(t.pnlPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {best && (
          <p className="rb-mine">
            내 종목 중 <b>{best.name}</b> <span className={'num ' + dirOf(best.chg)}>{pct(best.chg)}</span>
            {worst && worst !== best && (
              <>
                {' · '}
                <b>{worst.name}</b> <span className={'num ' + dirOf(worst.chg)}>{pct(worst.chg)}</span>
              </>
            )}
          </p>
        )}
      </div>

      <div className="mfoot">
        <button className="act-btn prime" onClick={onClose} autoFocus>
          확인
        </button>
      </div>
    </Modal>
  )
}
