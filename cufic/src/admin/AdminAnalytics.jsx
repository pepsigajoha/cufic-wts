import { useState } from 'react'
import { errorText } from '../supabase'
import { num } from '../format'

const ARCHETYPE_LABEL = {
  가치투자형: '🐢 가치투자형',
  단타형: '⚡ 단타형',
  분산투자형: '🧺 분산투자형',
  몰빵형: '🎯 몰빵형',
}

/**
 * 행동 텔레메트리 집계 탭 — admin_compute_team_analytics(0039)를 부르고 결과(game_team_analytics)를 보여준다.
 *
 * [한계] log_event를 부르는 화면이 아직 없어서(옵션 매수·주문창 열기 등 실제 상호작용 로깅 미연결),
 * FOMO 반응시간·존버의 달인/빛보다 빠른 손 배지는 실제 값이 쌓이기 전까지 대부분 비어 있거나 0으로 보인다.
 * 회전율·HHI·MDD는 trades·round_snapshots·positions만으로 계산되므로 지금도 정상적으로 나온다.
 */
export default function AdminAnalytics({ actions, board, analytics, refresh, notify }) {
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
