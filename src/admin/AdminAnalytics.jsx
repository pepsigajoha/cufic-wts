import { useMemo, useState } from 'react'
import { errorText } from '../supabase'
import { num, signed, pct, dirOf } from '../format'

const ARCHETYPE_LABEL = {
  가치투자형: '🐢 가치투자형',
  단타형: '⚡ 단타형',
  분산투자형: '🧺 분산투자형',
  몰빵형: '🎯 몰빵형',
}

const SORTS = [
  { key: 'pnl_pct', label: '수익률순' },
  { key: 'equity', label: '평가금액순' },
  { key: 'volume', label: '거래대금순' },
  { key: 'trades_total', label: '거래횟수순' },
  { key: 'name', label: '이름순' },
]

/** 참가자별 잔고·수익률·매매 통계 (admin_teams_status). 라운드 타이머가 열려 있으면 5초마다 자동 갱신된다. */
function ParticipantStats({ teams, game, liveOn, refreshLive, notify }) {
  const [sort, setSort] = useState('pnl_pct')
  const [busy, setBusy] = useState(false)
  const round = game?.current_round ?? 0

  const rows = useMemo(() => {
    const r = teams.map((t) => ({
      ...t,
      pnl: Number(t.pnl ?? 0),
      pnl_pct: Number(t.pnl_pct ?? 0),
      equity: Number(t.equity ?? 0),
      cash: Number(t.cash ?? 0),
      volume: Number(t.volume ?? 0),
      realized_pnl: Number(t.realized_pnl ?? 0),
      trades_total: Number(t.trades_total ?? 0),
      buy_count: Number(t.buy_count ?? 0),
      sell_count: Number(t.sell_count ?? 0),
      holdings_count: Number(t.holdings_count ?? 0),
      trades_this_round: Number(t.trades_this_round ?? 0),
    }))
    const cmp = {
      name: (a, b) => a.name.localeCompare(b.name, 'ko'),
      pnl_pct: (a, b) => b.pnl_pct - a.pnl_pct,
      equity: (a, b) => b.equity - a.equity,
      volume: (a, b) => b.volume - a.volume,
      trades_total: (a, b) => b.trades_total - a.trades_total,
    }
    return r.sort(cmp[sort] ?? cmp.pnl_pct)
  }, [teams, sort])

  const kpi = useMemo(() => {
    if (rows.length === 0) return null
    const pcts = rows.map((t) => t.pnl_pct)
    const avg = pcts.reduce((s, v) => s + v, 0) / rows.length
    const top = rows.reduce((a, b) => (b.pnl_pct > a.pnl_pct ? b : a))
    const bottom = rows.reduce((a, b) => (b.pnl_pct < a.pnl_pct ? b : a))
    return {
      count: rows.length,
      avg,
      top,
      bottom,
      trades: rows.reduce((s, t) => s + t.trades_total, 0),
      tradedThisRound: rows.filter((t) => t.trades_this_round > 0).length,
    }
  }, [rows])

  // 수익률 막대 폭 — 조들 중 최대 절대 수익률 기준(최소 10%)
  const maxAbs = Math.max(10, ...rows.map((t) => Math.abs(t.pnl_pct)))

  const doRefresh = async () => {
    setBusy(true)
    await refreshLive()
    setBusy(false)
    notify?.('최신 데이터로 갱신했어요', 'gold')
  }

  return (
    <section className="acard">
      <div className="acard-head">
        <span className="acap">참가자별 잔고 · 수익률 · 매매 통계 ({rows.length})</span>
        <span className="mon-live">
          {liveOn ? '🟢 실시간 (5초 자동)' : '⏸ 대기 — 라운드 타이머가 열리면 자동 갱신'}
          <button className="text-btn tiny" disabled={busy} onClick={doRefresh}>
            {busy ? '…' : '🔄 지금'}
          </button>
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="aempty">아직 참가한 조가 없어요.</p>
      ) : (
        <>
          {kpi && (
            <div className="mon-kpis">
              <div className="mon-kpi">
                <span className="k">참가 조</span>
                <span className="v num">{kpi.count}</span>
              </div>
              <div className="mon-kpi">
                <span className="k">평균 수익률</span>
                <span className={'v num ' + dirOf(kpi.avg)}>{pct(kpi.avg)}</span>
              </div>
              <div className="mon-kpi">
                <span className="k">최고 · {kpi.top.name}</span>
                <span className={'v num ' + dirOf(kpi.top.pnl_pct)}>{pct(kpi.top.pnl_pct)}</span>
              </div>
              <div className="mon-kpi">
                <span className="k">최저 · {kpi.bottom.name}</span>
                <span className={'v num ' + dirOf(kpi.bottom.pnl_pct)}>{pct(kpi.bottom.pnl_pct)}</span>
              </div>
              <div className="mon-kpi">
                <span className="k">누적 체결</span>
                <span className="v num">{num(kpi.trades)}</span>
              </div>
              <div className="mon-kpi">
                <span className="k">이번 R{round} 거래 조</span>
                <span className="v num">
                  {kpi.tradedThisRound}
                  <span className="sub"> / {kpi.count}</span>
                </span>
              </div>
            </div>
          )}

          <div className="mon-sort">
            <label>정렬</label>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="scroller">
            <table className="mon-table">
              <thead>
                <tr>
                  <th>조</th>
                  <th>예수금</th>
                  <th>평가금액</th>
                  <th>수익률</th>
                  <th>보유종목</th>
                  <th>거래(매수/매도)</th>
                  <th>거래대금</th>
                  <th>실현손익</th>
                  <th>이번 R</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const w = Math.min(50, (Math.abs(t.pnl_pct) / maxAbs) * 50)
                  const rising = t.pnl_pct >= 0
                  return (
                    <tr key={t.id ?? t.code ?? t.name}>
                      <td>{t.name}</td>
                      <td className="num">{num(t.cash)}</td>
                      <td className="num">{num(t.equity)}</td>
                      <td className={'num ' + dirOf(t.pnl)}>
                        <div className="mon-bar">
                          <span
                            className={'mon-fill ' + (rising ? 'up' : 'down')}
                            style={rising ? { left: '50%', width: w + '%' } : { right: '50%', width: w + '%' }}
                          />
                        </div>
                        {pct(t.pnl_pct)}
                        <div className="sub" style={{ color: 'inherit' }}>
                          {signed(t.pnl)}
                        </div>
                      </td>
                      <td className="num">{t.holdings_count}</td>
                      <td className="num">
                        {t.trades_total}
                        <span className="sub"> ({t.buy_count}/{t.sell_count})</span>
                      </td>
                      <td className="num">{num(t.volume)}</td>
                      <td className={'num ' + dirOf(t.realized_pnl)}>{signed(t.realized_pnl)}</td>
                      <td className="num">
                        {t.trades_this_round > 0 ? (
                          <span className="chip ok">{t.trades_this_round}</span>
                        ) : (
                          <span className="chip">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

/**
 * 통계 탭.
 *   1) 참가자별 잔고·수익률·매매 통계 — 라운드 중 5초 자동 갱신(실시간 모니터링).
 *   2) 행동 텔레메트리 집계 — admin_compute_team_analytics(0039), 수동 재집계.
 *
 * [한계] log_event를 부르는 화면이 아직 없어서 FOMO 반응시간·일부 배지는 대부분 비어 있다.
 * 회전율·HHI·MDD는 trades·round_snapshots·positions만으로 계산되므로 지금도 정상적으로 나온다.
 */
export default function AdminAnalytics({
  actions,
  game,
  teams = [],
  board,
  analytics,
  liveOn,
  refresh,
  refreshLive,
  notify,
}) {
  const [busy, setBusy] = useState(false)

  const nameOf = (teamId) => board.find((t) => t.team_id === teamId)?.name ?? teamId

  const compute = async () => {
    setBusy(true)
    const r = await actions.computeTeamAnalytics()
    setBusy(false)
    if (!r.ok) return notify(errorText(r.error), 'down')
    notify(`${r.computed ?? 0}개 조 집계 완료`, 'gold')
    await refresh()
  }

  const rows = (analytics ?? []).slice().sort((a, b) => nameOf(a.team_id).localeCompare(nameOf(b.team_id)))

  return (
    <div className="apanel">
      <ParticipantStats
        teams={teams}
        game={game}
        liveOn={liveOn}
        refreshLive={refreshLive}
        notify={notify}
      />

      <section className="acard">
        <div className="acard-head">
          <span className="acap">행동 텔레메트리 · 투자성향 ({rows.length})</span>
          <button className="text-btn" disabled={busy} onClick={compute}>
            {busy ? '집계 중…' : '🔄 지금 집계하기'}
          </button>
        </div>

        <p className="anote">
          회전율(총 매매대금/평균 평가금액)·포트폴리오 집중도(HHI)로 투자성향을 4분류하고, 배지를 계산합니다.
          라운드가 진행되는 동안 아무 때나 다시 눌러 최신 값으로 갱신할 수 있어요.
        </p>
        <p className="awarn">
          FOMO 반응시간·"존버의 달인"·"빛보다 빠른 손" 배지는 학생 화면의 상호작용 로깅(log_event)이
          아직 연결 안 돼 있어 정확하지 않을 수 있습니다. 회전율·집중도·MDD·"철벽 방어"(헷지 실행
          로그 필요)는 실제 체결·보유 데이터만으로 계산되어 지금도 정상 동작합니다.
        </p>

        {rows.length === 0 ? (
          <p className="aempty">아직 집계된 결과가 없어요 — "지금 집계하기"를 눌러보세요.</p>
        ) : (
          <div className="scroller">
            <table>
              <thead>
                <tr>
                  <th>조</th>
                  <th>투자성향</th>
                  <th>회전율</th>
                  <th>집중도(HHI)</th>
                  <th>최대낙폭</th>
                  <th>FOMO 반응</th>
                  <th>배지</th>
                  <th>집계 시각</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.team_id}>
                    <td>{nameOf(a.team_id)}</td>
                    <td>{ARCHETYPE_LABEL[a.archetype] ?? a.archetype ?? '—'}</td>
                    <td className="num">{a.turnover_rate != null ? `${(Number(a.turnover_rate) * 100).toFixed(0)}%` : '—'}</td>
                    <td className="num">{a.hhi != null ? num(Number(a.hhi)) : '—'}</td>
                    <td className="num">{a.mdd != null ? `${Number(a.mdd).toFixed(1)}%` : '—'}</td>
                    <td className="num">{a.fomo_reaction_ms != null ? `${(Number(a.fomo_reaction_ms) / 1000).toFixed(1)}초` : '—'}</td>
                    <td>
                      {(a.badges ?? []).length === 0 ? (
                        <span className="sub">없음</span>
                      ) : (
                        (a.badges ?? []).map((b) => (
                          <span key={b} className="tag-ok" style={{ marginRight: 4 }}>
                            {b}
                          </span>
                        ))
                      )}
                    </td>
                    <td className="sub">{a.computed_at ? new Date(a.computed_at).toLocaleString('ko-KR') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
