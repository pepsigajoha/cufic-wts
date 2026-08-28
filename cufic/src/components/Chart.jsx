import { useEffect, useMemo, useRef, useState } from 'react'
import { num, pct, dirOf, arrowOf } from '../format'
import { closePath, syntheticAnchor, priceAxis, TIMEFRAMES, SUB_TICK_INTERVAL_MS } from '../chart'
import { tickPrice } from '../realtimeTick'
import { useSize } from '../useSize'
import DrawLayer from './DrawLayer'

const PAD = { t: 18, r: 66, b: 18, l: 14 }

// 그림판 도구: 커서 · 펜 · 추세선 · 지우개
const TOOLS = [
  { key: 'cursor', title: '커서', icon: <path d="M4 2l7 18 2.5-7L20 11z" fill="currentColor" /> },
  {
    key: 'pen',
    title: '펜 (자유 그리기)',
    icon: (
      <>
        <path d="M12 19l7-7-4-4-7 7z" />
        <path d="M18 13l-1.5-6.5L21 5z" />
      </>
    ),
  },
  {
    key: 'line',
    title: '추세선 (시작점·끝점 두 번 누르기)',
    icon: (
      <>
        <path d="M4 20 20 4" />
        <circle cx="4" cy="20" r="2" fill="currentColor" stroke="none" />
        <circle cx="20" cy="4" r="2" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    key: 'eraser',
    title: '지우개',
    icon: (
      <>
        <path d="M4 15l6 6h8" />
        <path d="M14 5l5 5-9 9-5-5z" />
      </>
    ),
  },
]

export default function Chart({
  stock,
  onOpenFinancial,
  onOpenMarket,
  strokes,
  onStrokesChange,
  tradingOpen,
  remainingMs,
  durationMs,
  round,
  roundYearMap,
  timerState,
}) {
  const [tool, setTool] = useState('cursor')
  const [tfKey, setTfKey] = useState('T')
  const [plotRef, { w, h }] = useSize()

  const dir = dirOf(stock.chg)
  const tf = TIMEFRAMES.find((t) => t.key === tfKey) ?? TIMEFRAMES[0]

  // 부모(App.jsx)의 1초 카운트다운만으로는 실시간 잔떨림이 뚝뚝 끊겨 보인다 — 거래 시간
  // 동안만 훨씬 빠른 주기로 다시 렌더링해 tickPrice()가 매번 새 Date.now()를 보게 한다.
  // 순수 시각 효과일 뿐이라 체결가·평가금액 계산엔 전혀 관여하지 않고, 거래가 끝나면
  // 곧바로 멈춘다(불필요한 타이머가 계속 도는 일이 없다).
  const [, forceTick] = useState(0)
  useEffect(() => {
    if (!tradingOpen) return
    const id = setInterval(() => forceTick((n) => n + 1), 150)
    return () => clearInterval(id)
  }, [tradingOpen])

  // 부모는 remainingMs를 1초에 한 번만 갱신하는데, 위 150ms 로컬 리렌더는 그 사이사이에도
  // 돈다 — remainingMs(prop)를 그대로 쓰면 실제로는 계속 흐르는 시각(Date.now())과 눈금이
  // 안 맞아 "이미 잠긴 점"의 계산이 매 렌더마다 조금씩 달라진다(스냅의 진짜 원인이었다).
  // prop이 갱신된 그 순간의 (시각, 남은시간) 쌍을 기억해 뒀다가, 그 뒤로는 흐른 실제
  // 시간만큼 직접 보정한다 — 그러면 매 150ms 렌더에서도 "지금 남은 시간"이 끊김 없이
  // 매끄럽게 흐르고, 부모가 실제로 갱신될 때도 값이 튀지 않는다.
  const remainingRef = useRef({ ms: remainingMs ?? 0, at: Date.now() })
  useEffect(() => {
    remainingRef.current = { ms: remainingMs ?? 0, at: Date.now() }
  }, [remainingMs])
  const nowMs = Date.now()
  const effectiveRemainingMs = Math.max(0, remainingRef.current.ms - (nowMs - remainingRef.current.at))

  // 게임 시작 이후 실제로 확정된 라운드 가격들(R1..현재 라운드)을 그대로 이어 붙인
  // 하나의 긴 경로를 만든다. 매 라운드 처음부터 다시 그리지 않고, 지난 라운드들의
  // 실제 가격은 항상 고정으로 보여주고 "지금 라운드" 구간만 아래에서 실시간으로 드러낸다.
  // R1 이전엔 실제 데이터가 없어서, 왼쪽 끝 기준점으로 종목코드 고정 시드의 가상값(R0)을 하나 둔다.
  const { fullPath, liveStart, liveLen } = useMemo(() => {
    const years = Object.entries(roundYearMap || {})
      .map(([r, y]) => [Number(r), Number(y)])
      .filter(([r]) => r >= 1 && r <= (round ?? 0))
      .sort((a, b) => a[0] - b[0])

    const confirmed = years
      .map(([, y]) => ({ label: String(y), price: Number(stock.prices?.[String(y)] ?? 0) }))
      .filter((e) => e.price > 0)

    if (confirmed.length === 0) {
      // 대회 시작 전이거나 이 종목의 확정 가격이 아직 없다 — 현재가 하나만 보여준다.
      return { fullPath: [stock.price > 0 ? stock.price : 1], liveStart: 0, liveLen: 1 }
    }

    const anchor = syntheticAnchor(stock.code, confirmed[0].price)
    const points = [anchor, ...confirmed.map((e) => e.price)]
    const labels = ['R0', ...confirmed.map((e) => e.label)]

    const path = [points[0]]
    let liveStartIdx = 0
    for (let i = 1; i < points.length; i++) {
      const isLive = i === points.length - 1
      // '틱' 시간대에서 지금 라운드 구간만은 점 개수를 고정값(tf.count)이 아니라 SUB_TICK_INTERVAL_MS
      // (chart.js, 기본 1초)마다 한 틱이 되도록 라운드 길이로 역산한다 — 라운드가 길든
      // 짧든 항상 같은 간격을 유지하고, 간격을 바꾸고 싶으면 그 상수 하나만 고치면 된다.
      const count =
        isLive && tfKey === 'T' && durationMs > 0
          ? Math.max(2, Math.round(durationMs / SUB_TICK_INTERVAL_MS))
          : tf.count
      const seg = closePath(`${stock.code}:${labels[i - 1]}-${labels[i]}`, points[i - 1], points[i], count, tf.vol)
      liveStartIdx = path.length - 1
      path.push(...seg.slice(1)) // 첫 점은 이전 구간의 마지막 점과 겹치니 중복 제거
    }
    return { fullPath: path, liveStart: liveStartIdx, liveLen: path.length - liveStartIdx }
  }, [stock.code, stock.prices, stock.price, round, roundYearMap, tfKey, tf.count, tf.vol, durationMs])

  // "1틱 트레딩" 연출 — 지금 라운드 구간만 남은 시간에 맞춰 점점 드러난다.
  // - 거래 시간(live): 남은 시간에 비례해 드러난다. 남은 시간 0 = 정확히 이번 라운드 공식가.
  // - 라운드 종료(closed): 이미 다 그려졌던 그대로 유지(다시 마감된 채 보인다).
  // - 대기(waiting, 타이머 시작 전): 아직 하나도 안 드러난다 — 지난 라운드까지만 보여서
  //   "완성된 그래프가 미리 보이는" 스포일러를 막는다. 실제 그려지는 걸 봐야 결과를 안다.
  const revealFrac =
    timerState === 'live' && durationMs > 0
      ? Math.min(1, Math.max(0, 1 - effectiveRemainingMs / durationMs))
      : timerState === 'closed'
        ? 1
        : 0
  const liveRevealCount = Math.max(1, Math.ceil(revealFrac * liveLen))
  const revealedPath = fullPath.slice(0, Math.min(fullPath.length, liveStart + liveRevealCount))
  const tipIdx = Math.max(0, revealedPath.length - 1)
  const tipClose = revealedPath[tipIdx] ?? stock.price

  // 드러난 점들 사이(다음 점이 드러날 때까지)엔 작은 흔들림만 더해 계속 살아있게 보이게
  // 한다 — 큰 움직임은 위의 reveal이 담당하고, 이건 그 사이를 메우는 미세 잔떨림.
  // 체결가·평가금액엔 여전히 전혀 영향을 주지 않는다(서버가 확정한 stock.price만 쓴다).
  const livePrice = tradingOpen
    ? tickPrice({
        officialPrice: tipClose,
        seed: round ?? 0,
        stockId: stock.code,
        now: nowMs,
        remainingMs: effectiveRemainingMs,
        sigma: 0.012,
      })
    : stock.price

  // 지금 라운드 구간에서 팁이 다음 점으로 넘어가면, 방금까지 팁이었던 점은 "떨리다가
  // 갑자기 원래 값으로 튀는" 스냅 없이 — 그 점이 실제로 잠긴(더 이상 팁이 아니게 된)
  // 정확한 순간의 잔떨림 값 그대로 얼어붙어야 자연스럽다. j번째 점이 잠기는 순간의
  // remainingMs는 역산 가능하다(liveRevealCount = ceil(revealFrac·liveLen)의 역함수) —
  // 그 순간의 now·remainingMs로 tickPrice를 다시 평가하면 항상 같은 결과가 나온다
  // (결정론적이라 "얼린 값을 어딘가에 저장해 둘" 필요가 없다).
  const liveSegmentY = (i) => {
    if (i === revealedPath.length - 1) return livePrice
    if (!tradingOpen || !(durationMs > 0) || liveLen <= 0 || i < liveStart) return revealedPath[i]
    const j = i - liveStart
    const remainingMsAt = durationMs * (1 - (j + 1) / liveLen)
    const nowAt = nowMs - (remainingMsAt - effectiveRemainingMs)
    return tickPrice({
      officialPrice: revealedPath[i],
      seed: round ?? 0,
      stockId: stock.code,
      now: nowAt,
      remainingMs: remainingMsAt,
      sigma: 0.012,
    })
  }

  // y축 도메인(min/max/ticks)은 priceAxis(순수 함수, chart.js)가 전체 경로 기준으로 고정
  // 계산한다 — 그래야 점이 드러날 때마다 축이 다시 스케일되며 튀지 않는다.
  // x축은 반대로 "지금까지 드러난 만큼"을 기준으로 매번 다시 잡는다 — 그래야 지금 드러난
  // 선이 항상 플롯 영역을 꽉 채운다(고정폭 기준으로 잡으면 라운드 초반엔 선이 왼쪽 일부에만
  // 그려지고 오른쪽에 빈 공간이 크게 남는다). 슬롯 중앙(+0.5)이 아니라 양 끝(0·n-1)이
  // 정확히 플롯 좌우 끝에 닿게 잡아야 실시간 점이 오른쪽 끝과 어긋나지 않는다.
  const geom = useMemo(() => {
    const { min, max, ticks } = priceAxis(fullPath)
    const plotW = Math.max(1, w - PAD.l - PAD.r)
    const plotH = Math.max(1, h - PAD.t - PAD.b)
    const n = Math.max(1, revealedPath.length)
    const step = n > 1 ? plotW / (n - 1) : 0

    return {
      x: (i) => (n > 1 ? PAD.l + step * i : PAD.l + plotW / 2),
      y: (v) => PAD.t + (1 - (v - min) / (max - min)) * plotH,
      ticks,
    }
  }, [fullPath, revealedPath.length, w, h])

  const { x, y, ticks } = geom
  const ready = w > 0 && h > 0
  // 마지막 점은 항상 livePrice(잔떨림 포함)로 그린다 — 그래야 가격선의 끝·그라디언트
  // 음영의 우상단 모서리·펄스 점·기준선이 전부 정확히 같은(반올림까지 동일한) 좌표를
  // 공유한다. 1자리로 반올림해 문자열(points)과 숫자(cx/cy) 표현이 부동소수점 오차로
  // 미세하게 어긋나는 일이 없게 한다(어긋남/찢김 방지).
  const tipX = Number(x(tipIdx).toFixed(1))
  const tipY = Number(y(livePrice).toFixed(1))
  const pointY = (i) => Number(y(liveSegmentY(i)).toFixed(1))
  const pricePoints = revealedPath.map((v, i) => `${x(i).toFixed(1)},${pointY(i)}`).join(' ')
  // 가격선 아래로 은은한 그라디언트 음영 — 추세를 시각적으로 눈에 더 띄게 한다.
  const priceFillPath = useMemo(() => {
    if (!ready || revealedPath.length < 2) return ''
    const baseY = (h - PAD.b).toFixed(1)
    const top = revealedPath.map((v, i) => `${x(i).toFixed(1)},${pointY(i)}`)
    return `M${top[0]} L${top.join(' L')} L${x(revealedPath.length - 1).toFixed(1)},${baseY} L${x(0).toFixed(1)},${baseY} Z`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealedPath, tipY, x, y, h, ready])

  return (
    <main className="col chart">
      <div className="top">
        <span className="name">{stock.name}</span>
        <span className="code2">{stock.market}</span>
        {stock.halted ? (
          <span className="halted-tag big">거래정지</span>
        ) : (
          <>
            <span className={'now num ' + dir}>{num(stock.price)}</span>
            {/* 순수 장식용 — 숫자·색은 항상 실제 공식가 그대로다. 거래 중임을 알리는
                점일 뿐, 어떤 값도 바꾸지 않는다. */}
            {tradingOpen && <span className="live-dot" aria-hidden="true" />}
            <span className={'delta num ' + dir}>
              {arrowOf(stock.chg)} {num(Math.abs(stock.delta))}
              <br />
              {pct(stock.chg)}
            </span>
          </>
        )}
        <div className="chart-tools">
          {onOpenMarket && (
            <button className="fin" onClick={onOpenMarket} title="시황판 보기">
              📈 시황
            </button>
          )}
          <button className="fin" onClick={onOpenFinancial}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3v18h18" />
              <rect x="7" y="10" width="3" height="7" />
              <rect x="12" y="6" width="3" height="11" />
              <rect x="17" y="13" width="3" height="4" />
            </svg>
            재무제표
          </button>
        </div>
      </div>

      <div className="draw">
        <div className="grp">
          {TOOLS.map((t) => (
            <button
              key={t.key}
              className={'tool' + (tool === t.key ? ' act' : '')}
              title={t.title}
              aria-label={t.title}
              aria-pressed={tool === t.key}
              onClick={() => setTool(t.key)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {t.icon}
              </svg>
            </button>
          ))}
        </div>

        <div className="tf">
          {TIMEFRAMES.map((t) => (
            <button key={t.key} className={tfKey === t.key ? 'on' : ''} onClick={() => setTfKey(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* viewBox를 실측 픽셀에 1:1로 맞춰 글자 왜곡을 막는다 */}
      <div className="plot" ref={plotRef}>
        {stock.halted && <div className="plot-empty">거래가 정지된 종목이라 차트가 없어요</div>}
        {ready && !stock.halted && (
          <svg viewBox={`0 0 ${w} ${h}`}>
            <defs>
              <linearGradient id="price-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" className="price-fill-stop-start" />
                <stop offset="100%" className="price-fill-stop-end" />
              </linearGradient>
            </defs>
            <g className="grid">
              {ticks.map((v, i) => (
                <line key={i} x1={PAD.l} y1={y(v)} x2={w - PAD.r} y2={y(v)} />
              ))}
            </g>
            <g className="axis">
              {ticks.map((v, i) => (
                <text key={i} x={w - PAD.r + 8} y={y(v) + 3.5}>
                  {num(v)}
                </text>
              ))}
            </g>

            {priceFillPath && <path className="price-fill" d={priceFillPath} />}
            <polyline className="price-line" points={pricePoints} />

            {/* 지금 가격 수준을 가로질러 보여주는 기준선 + 그 위의 펄스 점(실시간 틱).
                가격선의 끝점도 y(livePrice)로 그리므로(위 tipY) 이 셋은 항상 정확히 같은
                y좌표를 공유한다 — 점만 따로 떠 보이는 어긋남이 생기지 않는다. */}
            <line className={'nowline ' + dir} x1={PAD.l} y1={tipY} x2={w - PAD.r} y2={tipY} />
            {tradingOpen && <circle className={'nowline-pulse ' + dir} cx={tipX} cy={tipY} r={3.5} />}
          </svg>
        )}

        {ready && (
          <DrawLayer tool={tool} strokes={strokes} onChange={onStrokesChange} w={w} h={h} />
        )}
      </div>
    </main>
  )
}
