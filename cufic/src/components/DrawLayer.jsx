import { useEffect, useRef, useState } from 'react'
import { strokeHit } from '../draw'

let seq = 0
const nextId = () => `s${++seq}`

/**
 * 차트 위 그리기 오버레이.
 *
 * 좌표는 0~1 정규화해서 보관한다 — 창 크기가 바뀌어도 선이 차트를 따라가야 하므로
 * 픽셀 좌표로 저장하면 안 된다.
 *
 * 선은 종류에 상관없이 전부 {id, points:[[nx,ny],...]} 하나로 표현한다.
 * 추세선은 점이 2개인 선일 뿐이라, 지우개 판정도 그대로 적용된다.
 *
 * @param {'cursor'|'pen'|'line'|'eraser'} tool
 * @param {{id:string, points:[number,number][]}[]} strokes
 * @param {(next: any[]) => void} onChange
 * @param {number} w  플롯 실측 너비(px)
 * @param {number} h  플롯 실측 높이(px)
 */
export default function DrawLayer({ tool, strokes, onChange, w, h }) {
  const ref = useRef(null)
  const down = useRef(false)
  const [live, setLive] = useState(null) // 펜으로 긋는 중인 선
  const [lineStart, setLineStart] = useState(null) // 추세선 시작점 (첫 탭)
  const [hover, setHover] = useState(null) // 추세선 미리보기 끝점

  const active = tool === 'pen' || tool === 'line' || tool === 'eraser'

  // 도구를 바꾸면 그리던 것을 전부 버린다
  useEffect(() => {
    down.current = false
    setLive(null)
    setLineStart(null)
    setHover(null)
  }, [tool])

  const toNorm = (e) => {
    const r = ref.current.getBoundingClientRect()
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]
  }

  const commit = (points) => onChange([...strokes, { id: nextId(), points }])

  // 지우개에 닿은 선을 통째로 지운다 (판정은 draw.js의 strokeHit)
  const eraseAt = ([nx, ny]) => {
    const kept = strokes.filter((s) => !strokeHit(s, nx * w, ny * h, w, h))
    if (kept.length !== strokes.length) onChange(kept)
  }

  const onPointerDown = (e) => {
    if (!active) return
    const pt = toNorm(e)

    // 추세선: 탭 두 번(시작점 → 끝점). 드래그가 아니라 포인터 캡처를 잡지 않는다.
    if (tool === 'line') {
      if (!lineStart) {
        setLineStart(pt)
        setHover(pt)
      } else {
        commit([lineStart, pt])
        setLineStart(null)
        setHover(null)
      }
      return
    }

    e.currentTarget.setPointerCapture(e.pointerId)
    down.current = true
    if (tool === 'pen') setLive({ points: [pt] })
    else eraseAt(pt)
  }

  const onPointerMove = (e) => {
    if (!active) return

    // 추세선 미리보기 (마우스에서만 보인다 — 터치는 손을 떼면 이동이 추적되지 않음)
    if (tool === 'line') {
      if (lineStart) setHover(toNorm(e))
      return
    }

    if (!down.current) return
    const pt = toNorm(e)
    if (tool === 'pen') setLive((s) => (s ? { points: [...s.points, pt] } : s))
    else eraseAt(pt)
  }

  const onPointerUp = () => {
    if (!down.current) return
    down.current = false
    if (tool === 'pen' && live) {
      // 점 하나(탭)면 같은 점을 겹쳐 넣어 둥근 점으로 찍히게 한다
      commit(live.points.length === 1 ? [live.points[0], live.points[0]] : live.points)
    }
    setLive(null)
  }

  const toPath = (points) =>
    points.map(([nx, ny]) => `${(nx * w).toFixed(1)},${(ny * h).toFixed(1)}`).join(' ')

  const hint =
    tool === 'pen'
      ? '차트 위에 그려보세요'
      : tool === 'line'
        ? lineStart
          ? '끝점을 한 번 더 누르세요'
          : '시작점을 누르세요'
        : '지울 선을 문지르세요'

  return (
    <>
      <svg
        ref={ref}
        className={'draw-layer' + (active ? ' active ' + tool : '')}
        viewBox={`0 0 ${w} ${h}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {strokes.map((s) => (
          <polyline key={s.id} className="stroke" points={toPath(s.points)} />
        ))}
        {live && <polyline className="stroke live" points={toPath(live.points)} />}

        {/* 추세선: 시작점 표시 + 끝점까지 점선 미리보기 */}
        {lineStart && (
          <>
            {hover && <polyline className="stroke preview" points={toPath([lineStart, hover])} />}
            <circle
              className="anchor"
              cx={lineStart[0] * w}
              cy={lineStart[1] * h}
              r="4"
            />
          </>
        )}
      </svg>

      {active && <div className="draw-hint">{hint}</div>}
    </>
  )
}
