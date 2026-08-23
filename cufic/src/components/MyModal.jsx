import { useState } from 'react'
import Modal from './Modal'
import { num, signed, pct, dirOf } from '../format'
import { positionPnl } from '../account'

const TABS = [
  { key: 'holdings', label: '보유종목' },
  { key: 'history', label: '체결내역' },
  { key: 'returns', label: '수익률' },
]

/** 억 단위 축약 라벨 (수백억까지 읽히게) */
const eokShort = (v) => {
  const e = v / 1e8
  if (Math.abs(e) >= 100) return Math.round(e) + '억'
  if (Math.abs(e) >= 1) return e.toFixed(1) + '억'
  return Math.round(v / 1e4).toLocaleString() + '만'
}

function EqToggle({ view, setView }) {
  return (
    <div className="eq-toggle">
      <button className={view === 'curve' ? 'on' : ''} onClick={() => setView('curve')}>
        자산 곡선
      </button>
      <button className={view === 'bars' ? 'on' : ''} onClick={() => setView('bars')}>
        라운드별 수익률
      </button>
    </div>
  )
}

/**
 * 수익률 뷰. points: [{label, equity}] (시작 → R1 … 지금).
 * 힌트를 잘 따르면 자산이 지수적으로 커져서 선형 축은 마지막만 튀어 보인다. 그래서:
 *   · 자산 곡선  = 로그 스케일 + 억 단위 축약 (몇 배 커졌는지 읽힘)
 *   · 라운드별 수익률 = 라운드마다 몇 % 벌었나 (막대). 토글로 전환.
 */
function EquityChart({ points }) {
  const [view, setView] = useState('curve')
  const W = 660
  const H = 260
  const PAD = { t: 24, r: 18, b: 40, l: 64 }
  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b
  const x = (i) => PAD.l + (plotW * i) / Math.max(1, points.length - 1)

  if (view === 'bars') {
    const bars = points.slice(1).map((p, i) => {
      const prev = points[i].equity || 1
      return { label: p.label, pct: ((p.equity - prev) / prev) * 100 }
    })
    const maxAbs = Math.max(10, ...bars.map((b) => Math.abs(b.pct)))
    const zeroY = PAD.t + plotH / 2
    const bw = Math.min(48, (plotW / Math.max(1, bars.length)) * 0.55)
    const bx = (i) => PAD.l + (plotW * (i + 0.5)) / bars.length
    return (
      <div className="eqchart">
        <EqToggle view={view} setView={setView} />
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="라운드별 수익률">
          <line className="eq-grid" x1={PAD.l} y1={zeroY} x2={W - PAD.r} y2={zeroY} />
          {bars.map((b, i) => {
            const up = b.pct >= 0
            const bh = Math.max(1, (Math.abs(b.pct) / maxAbs) * (plotH / 2))
            return (
              <g key={i}>
                <rect
                  className={'eqbar ' + (up ? 'up' : 'down')}
                  x={bx(i) - bw / 2}
                  y={up ? zeroY - bh : zeroY}
                  width={bw}
                  height={bh}
                />
                <text
                  className="eq-label"
                  x={bx(i)}
                  y={up ? zeroY - bh - 6 : zeroY + bh + 14}
                  textAnchor="middle"
                >
                  {(b.pct >= 0 ? '+' : '') + b.pct.toFixed(0)}%
                </text>
                <text className="eq-label" x={bx(i)} y={H - 12} textAnchor="middle">
                  {b.label}
                </text>
              </g>
            )
          })}
        </svg>
        <p className="eq-note">막대는 그 라운드에 오르내린 폭이에요. 빨강 = 벌었다 / 파랑 = 잃었다.</p>
      </div>
    )
  }

  // 자산 곡선 (로그 스케일)
  const lg = (v) => Math.log10(Math.max(v, 1))
  const lo = Math.min(...points.map((p) => lg(p.equity)))
  const hi = Math.max(...points.map((p) => lg(p.equity)))
  const pad = (hi - lo) * 0.15 || 0.3
  const min = lo - pad
  const max = hi + pad
  const y = (v) => PAD.t + (1 - (lg(v) - min) / (max - min)) * plotH
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`).join(' ')
  const area = `${PAD.l},${PAD.t + plotH} ${line} ${PAD.l + plotW},${PAD.t + plotH}`
  // 10^ 정수 지수 눈금 (억 단위 라벨). 폭이 좁으면 양 끝+중간.
  const ticks = []
  for (let e = Math.ceil(min); e <= Math.floor(max); e++) ticks.push(Math.pow(10, e))
  if (ticks.length < 2) {
    ticks.length = 0
    ticks.push(Math.pow(10, min), Math.pow(10, (min + max) / 2), Math.pow(10, max))
  }

  return (
    <div className="eqchart">
      <EqToggle view={view} setView={setView} />
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="라운드별 자산 (로그 스케일)">
        {ticks.map((v, i) => (
          <g key={i}>
            <line className="eq-grid" x1={PAD.l} y1={y(v)} x2={W - PAD.r} y2={y(v)} />
            <text className="eq-label" x={PAD.l - 8} y={y(v) + 3.5} textAnchor="end">
              {eokShort(v)}
            </text>
          </g>
        ))}
        <polygon className="eq-area" points={area} />
        <polyline className="eq-line" points={line} />
        {points.map((p, i) => (
          <g key={p.label}>
            <circle className="eq-dot" cx={x(i)} cy={y(p.equity)} r="4" />
            <text className="eq-label" x={x(i)} y={H - 12} textAnchor="middle">
              {p.label}
            </text>
          </g>
        ))}
      </svg>
      <p className="eq-note">세로축은 로그 스케일이에요 — 몇 배로 커졌는지 보기 쉽게 했어요.</p>
    </div>
  )
}

export default function MyModal({ open, onClose, account, realized, stocks, history, rounds }) {
  const [tab, setTab] = useState('holdings')
  const held = stocks.filter((s) => s.holding > 0)
  const dir = dirOf(account.pnl)

  return (
    <Modal open={open} onClose={onClose} title="MY · 내 계좌" wide>
      <div className="sumbar">
        <div className="cell">
          <span className="k">평가금액</span>
          <span className="v num">₩ {num(account.equity)}</span>
        </div>
        <div className="cell">
          <span className="k">주문가능</span>
          <span className="v num">₩ {num(account.cash)}</span>
        </div>
        <div className="cell">
          <span className="k">총 손익</span>
          <span className={'v num ' + dir}>
            {signed(account.pnl)}
            <span style={{ fontSize: 12, marginLeft: 4 }}>({pct(account.pnlPct)})</span>
          </span>
        </div>
        {/* 아직 갖고 있는 것의 평가손익과 달리, 팔아서 확정된 돈 */}
        <div className="cell">
          <span className="k">실현손익 · 판 것에서 번 돈</span>
          <span className={'v num ' + dirOf(realized)}>{signed(realized)}</span>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'holdings' && (
        <table>
          <thead>
            <tr>
              <th>종목</th>
              <th>보유수량</th>
              <th>평균단가</th>
              <th>현재가</th>
              <th>평가손익</th>
            </tr>
          </thead>
          <tbody>
            {held.length === 0 && (
              <tr>
                <td colSpan="5" className="tbl-empty">
                  아직 보유한 종목이 없어요
                </td>
              </tr>
            )}
            {held.map((s) => {
              const p = positionPnl(s)
              const d = dirOf(p.pnl)
              return (
                <tr key={s.code} className={s.halted ? 'delisted-row' : ''}>
                  <td>
                    {s.name}
                    {s.halted && <span className="delist-tag">⚠ 상장폐지</span>}
                  </td>
                  <td className="num">{num(s.holding)}</td>
                  <td className="num">{num(s.avgPrice)}</td>
                  <td className="num">{num(s.price)}</td>
                  <td className={'num ' + d}>
                    {signed(p.pnl)}
                    <div className="sub" style={{ color: 'inherit' }}>
                      {pct(p.pnlPct)}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {tab === 'history' && (
        <table>
          <thead>
            <tr>
              <th>체결 시점</th>
              <th>종목</th>
              <th>구분</th>
              <th>체결가</th>
              <th>수량</th>
              <th>체결금액</th>
              <th>실현손익</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 && (
              <tr>
                <td colSpan="7" className="tbl-empty">
                  아직 거래 내역이 없어요
                </td>
              </tr>
            )}
            {history.map((h, i) => (
              <tr key={i}>
                <td>
                  {h.year ? `R${h.round} · ${h.year}년` : `R${h.round}`}
                  <div className="sub num">{h.time}</div>
                </td>
                <td>{h.name}</td>
                <td>
                  <span className={'tag ' + (h.side === 'buy' ? 'b' : 's')}>
                    {h.side === 'buy' ? '매수' : '매도'}
                  </span>
                </td>
                <td className="num">{num(h.price)}</td>
                <td className="num">{num(h.qty)}</td>
                <td className="num">{num(h.amount)}</td>
                {/* 매수는 아직 손익이 확정되지 않았다 */}
                <td className={'num ' + (h.side === 'sell' ? dirOf(h.realized ?? 0) : '')}>
                  {h.side === 'sell' ? signed(h.realized ?? 0) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === 'returns' && <EquityChart points={rounds} />}
    </Modal>
  )
}
