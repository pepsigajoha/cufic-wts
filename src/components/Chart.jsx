import { useEffect, useMemo, useState } from 'react'
import { num, pct, dirOf, arrowOf } from '../format'
import { downsample, priceAxis, roundStepIndex, STEPS_PER_YEAR, TIMEFRAMES } from '../chart'
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
  round,
  roundYearMap,
  timerState,
  game,
}) {
  const [tool, setTool] = useState('cursor')
  const [tfKey, setTfKey] = useState('W') // 초기 마운트 기본 주기 = 주봉
  const [plotRef, { w, h }] = useSize()

  const dir = dirOf(stock.chg)
  const tf = TIMEFRAMES.find((t) => t.key === tfKey) ?? TIMEFRAMES[0]

  // 거래 시간 동안만 빠르게 리렌더해서 "지금 몇 번째 날까지 드러났는지"(reveal)가 매끄럽게
  // 흐르게 한다. roundStepIndex(game, Date.now())가 진행률을 계산하므로 새 Date.now()만 있으면 된다.
  const [, forceTick] = useState(0)
  useEffect(() => {
    if (!tradingOpen) return
    const id = setInterval(() => forceTick((n) => n + 1), 150)
    return () => clearInterval(id)
  }, [tradingOpen])
  const nowMs = Date.now()

  // 서버가 저장한 실제 시뮬레이션 경로를 tf 해상도로 그린다(가짜 보간 없음).
  //  - 과거 연도 : 최근 tf.window개만, 각 경로를 tf.count개로 다운샘플해 이어 붙인다.
  //  - 지금 연도 : 경로를 tf.count개로 다운샘플(livePath). 아래 reveal이 진행률만큼만 그린다.
  //  - 경로 없는 연도 : 연말 스칼라 한 점(옛 데이터 하위호환).
  const { fullPath, pastPath, livePath } = useMemo(() => {
    const curYear = roundYearMap?.[String(round)] != null ? Number(roundYearMap[String(round)]) : null
    const allCompleted = Object.entries(roundYearMap || {})
      .map(([r, y]) => [Number(r), Number(y)])
      .filter(([r, y]) => r >= 1 && r <= (round ?? 0) && y !== curYear)
      .sort((a, b) => a[0] - b[0])
      .map(([, y]) => y)
    // 지금 연도 1개는 아래에서 따로 그리므로 과거는 window-1개만 (slice(-0)이 전체를 반환하는 함정 회피)
    const keepPast = Math.max(0, tf.window - 1)
    const completed = keepPast === 0 ? [] : allCompleted.slice(-keepPast)

    const byYear = stock.pricePathsByYear ?? {}
    const past = []
    for (const y of completed) {
      const p = byYear[y]
      if (Array.isArray(p) && p.length) past.push(...downsample(p, tf.count))
      else {
        const scalar = Number(stock.prices?.[String(y)] ?? 0)
        if (scalar > 0) past.push(scalar)
      }
    }

    const rawLive = curYear != null ? byYear[curYear] : null
    let live
    if (Array.isArray(rawLive) && rawLive.length) live = downsample(rawLive, tf.count)
    else {
      const scalar = Number(stock.prices?.[String(curYear)] ?? stock.price ?? 0)
      live = scalar > 0 ? [scalar] : []
    }

    const full = [...past, ...live]
    if (full.length === 0) return { fullPath: [stock.price > 0 ? stock.price : 1], pastPath: [], livePath: [] }
    return { fullPath: full, pastPath: past, livePath: live }
  }, [stock.prices, stock.price, stock.pricePathsByYear, round, roundYearMap, tf.count, tf.window])

  // reveal — 지금 라운드 경로를 진행률만큼만, tf.count 단위로 끊어 드러낸다.
  //  - live   : 진행률 × tf.count 개까지. 틱(252)은 자주·촘촘, 년(12)은 드물게·크게 전진.
  //  - closed : 경로 전체(마지막 점 = 연말 확정가).
  //  - waiting: 아직 안 그린다 — 완성된 그래프가 미리 보이는 스포일러 방지.
  const stepIdx = roundStepIndex(game, nowMs) // 0..251
  const revealFrac =
    timerState === 'closed' ? 1 : timerState === 'live' ? (stepIdx + 1) / STEPS_PER_YEAR : 0
  const liveRevealCount =
    revealFrac <= 0 ? 0 : Math.min(livePath.length, Math.max(1, Math.ceil(revealFrac * livePath.length)))
  const revealedLive = livePath.slice(0, liveRevealCount)
  const assembled = [...pastPath, ...revealedLive]
  const revealedPath = assembled.length ? assembled : [stock.price > 0 ? stock.price : 1]
  const tipIdx = Math.max(0, revealedPath.length - 1)
  const livePrice = revealedPath[tipIdx] ?? stock.price

  // 각 점의 y값 = 그 점의 실제 경로 값(잔떨림·재계산 없음).
  const liveSegmentY = (i) => revealedPath[i]

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
