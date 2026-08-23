import { useState } from 'react'
import { num, signed, pct, dirOf } from '../format'
import { select } from '../supabase'

// CSV 셀 이스케이프 + UTF-8 BOM(엑셀에서 바로 열림)
const cell = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
const toCsv = (rows) => rows.map((r) => r.map(cell).join(',')).join('\r\n')

/** 리더보드 탭. 프로젝터로 띄우는 큰 글씨 모드 + 대회 결과 CSV 내보내기. */
export default function AdminBoard({ game, board, stocks = [] }) {
  const [big, setBig] = useState(false)
  const [busy, setBusy] = useState(false)

  // 대회 결과 내보내기 — 순위·수익률 + 라운드별 스냅샷 + 거래 로그를 한 CSV로
  const exportResults = async () => {
    setBusy(true)
    const [trR, snR] = await Promise.all([select('trades', '*'), select('round_snapshots', '*')])
    setBusy(false)
    const trades = trR.ok ? trR.rows : []
    const snaps = snR.ok ? snR.rows : []
    const nameOf = (id) => board.find((t) => t.team_id === id)?.name ?? id
    const stockName = (id) => stocks.find((s) => s.id === id)?.name ?? id
    const rounds = [...new Set(snaps.map((s) => Number(s.round)))].sort((a, b) => a - b)

    const rows = []
    rows.push(['[순위]'])
    rows.push(['순위', '조', '평가금액', '수익률(%)', '손익'])
    board.forEach((t) => rows.push([t.rank, t.name, t.equity, t.pnl_pct, t.pnl]))
    rows.push([])
    rows.push(['[라운드별 평가금액(스냅샷)]'])
    rows.push(['조', ...rounds.map((r) => (r > (game?.total_rounds ?? 99) ? '최종' : 'R' + r))])
    board.forEach((t) =>
      rows.push([t.name, ...rounds.map((r) => snaps.find((s) => s.team_id === t.team_id && Number(s.round) === r)?.equity ?? '')]),
    )
    rows.push([])
    rows.push(['[거래 로그]'])
    rows.push(['라운드', '조', '종목', '구분', '체결가', '수량', '체결금액', '실현손익', '시각'])
    trades
      .slice()
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .forEach((t) =>
        rows.push([
          t.round,
          nameOf(t.team_id),
          stockName(t.stock_id),
          t.side === 'buy' ? '매수' : '매도',
          t.price,
          t.quantity,
          Number(t.price) * Number(t.quantity),
          t.realized_pnl ?? '',
          t.created_at,
        ]),
      )

    const bom = new Uint8Array([0xef, 0xbb, 0xbf])
    const blob = new Blob([bom, toCsv(rows)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `대회결과.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // 단독 1위일 때만 골드 강조. 공동 1위(동률)면 아무도 강조하지 않는다.
  const soleFirst = board.filter((t) => Number(t.rank) === 1).length === 1

  const rankMove = (t) => {
    if (t.prev_rank == null) return null
    const d = Number(t.prev_rank) - Number(t.rank)
    if (d === 0) return { txt: '—', cls: 'flat' }
    return d > 0 ? { txt: `▲${d}`, cls: 'up' } : { txt: `▼${-d}`, cls: 'down' }
  }

  return (
    <div className={'apanel board-panel' + (big ? ' big' : '')}>
      <section className="acard">
        <div className="acard-head">
          <span className="acap">
            조별 순위
            {game && game.current_round > 0 && (
              <> · ROUND {game.current_round} · {game.round_year_map?.[String(game.current_round)]}년</>
            )}
          </span>
          <button className="text-btn" disabled={busy || board.length === 0} onClick={exportResults}>
            📥 대회 결과 내보내기 (CSV)
          </button>
          <button className="text-btn" onClick={() => setBig((b) => !b)}>
            {big ? '보통 글씨' : '큰 글씨 (프로젝터)'}
          </button>
        </div>

        <p className="anote">순위는 라운드를 넘길 때만 바뀝니다.</p>

        {board.length === 0 ? (
          <p className="aempty">등록된 조가 없습니다.</p>
        ) : (
          <div className="lb">
            {board.map((t) => {
              const mv = rankMove(t)
              return (
                <div
                  key={t.team_id}
                  className={'lb-row' + (Number(t.rank) === 1 && soleFirst ? ' rank1' : '')}
                >
                  <span className="lb-rank">{t.rank}</span>
                  <span className="lb-name">{t.name}</span>
                  {mv && <span className={'lb-move ' + mv.cls}>{mv.txt}</span>}
                  <span className="lb-eq num">₩ {num(t.equity)}</span>
                  <span className={'lb-pct num ' + dirOf(Number(t.pnl))}>
                    {pct(Number(t.pnl_pct))}
                    <span className="lb-pnl">{signed(Number(t.pnl))}</span>
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
