import { useMemo } from 'react'
import Modal from './Modal'
import { EquityChart } from './MyModal'
import { num, signed, pct, dirOf } from '../format'

/**
 * 라운드 전환 요약. 라운드제 게임의 하이라이트 순간이므로 반드시 알린다 —
 * 조용히 12종목 가격만 바뀌면 학생은 무슨 일이 일어났는지 알 수 없다.
 *
 * @param {{round:number, year:number}|null} round  null이면 닫힘
 * @param {number|null} prevEquity  직전 라운드를 떠날 때의 평가금액. 이번 전환으로
 *   내 자산이 얼마나 움직였는지 보여주는 기준. 없으면(첫 전환 등) 원금 대비로 대체.
 */
export default function RoundModal({
  round,
  account,
  stocks,
  rounds = [],
  rows = [],
  prevEquity,
  rank,
  prevRank,
  teamCount,
  onClose,
}) {
  // 내가 들고 있는 종목의 등락 하이라이트(내 종목 중 최고·최악).
  const { best, worst, delisted } = useMemo(() => {
    const mine = stocks.filter((s) => s.holding > 0 && !s.halted)
    // 보유 중인데 가격 0이 된 종목 = 상장폐지(전액 손실)
    const delisted = stocks.filter((s) => s.holding > 0 && s.halted)
    if (!mine.length) return { best: null, worst: null, delisted }
    const sorted = [...mine].sort((a, b) => b.chg - a.chg)
    return { best: sorted[0], worst: sorted.length > 1 ? sorted[sorted.length - 1] : null, delisted }
  }, [stocks])

  // 전체 종목 등락률 바 차트 — 상장된 종목 전부, 등락률 내림차순. + 시장 폭(오른/내린 종목 수).
  const { market, maxAbs, breadth } = useMemo(() => {
    const listed = stocks.filter((s) => !s.preListed)
    const market = [...listed].sort((a, b) => b.chg - a.chg)
    const maxAbs = Math.max(10, ...market.filter((s) => !s.halted).map((s) => Math.abs(s.chg)))
    const breadth = {
      up: market.filter((s) => !s.halted && s.chg > 0).length,
      down: market.filter((s) => !s.halted && s.chg < 0).length,
      flat: market.filter((s) => !s.halted && s.chg === 0).length,
      halted: market.filter((s) => s.halted).length,
    }
    return { market, maxAbs, breadth }
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

        {/* 자산 변동 요약 카드 */}
        <div className="rsum-cards">
          <div className="rsum-card">
            <span className="k">예수금(현금)</span>
            <span className="v num">₩ {num(account.cash)}</span>
          </div>
          <div className="rsum-card">
            <span className="k">보유주식 평가</span>
            <span className="v num">₩ {num(account.equity - account.cash)}</span>
          </div>
          <div className="rsum-card">
            <span className="k">누적 손익(원금 대비)</span>
            <span className={'v num ' + dirOf(account.pnl)}>
              {signed(account.pnl)} ({pct(account.pnlPct)})
            </span>
          </div>
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

        {/* 라운드별 자산 그래프 (스냅샷 기반) */}
        {rounds.length >= 2 && (
          <div className="rsum-graph">
            <span className="rb-cap">라운드별 내 자산</span>
            <EquityChart points={rounds} />
          </div>
        )}

        {/* 전체 종목 등락률 바 차트 */}
        {market.length > 0 && (
          <div className="chgbars">
            <span className="rb-cap">
              전체 종목 등락률
              <span className="cb-breadth">
                ▲{breadth.up} ▼{breadth.down}
                {breadth.flat ? ` −${breadth.flat}` : ''}
                {breadth.halted ? ` ⏸${breadth.halted}` : ''}
              </span>
            </span>
            <div className="chgbar-list">
              {market.map((s) => {
                const w = s.halted ? 0 : Math.min(50, (Math.abs(s.chg) / maxAbs) * 50)
                const rising = s.chg >= 0
                return (
                  <div key={s.code} className={'chgbar-row' + (s.holding > 0 ? ' mine' : '')}>
                    <span className="cb-name">
                      {s.holding > 0 && <i className="cb-dot" aria-hidden="true" />}
                      {s.name}
                    </span>
                    <div className="cb-track">
                      {!s.halted && (
                        <span
                          className={'cb-fill ' + (rising ? 'up' : 'down')}
                          style={rising ? { left: '50%', width: w + '%' } : { right: '50%', width: w + '%' }}
                        />
                      )}
                    </div>
                    <span className={'cb-val num ' + (s.halted ? 'cb-halt' : dirOf(s.chg))}>
                      {s.halted ? '정지' : pct(s.chg)}
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="rb-mine">● 표시는 내가 보유한 종목이에요.</p>
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
