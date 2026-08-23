import { describe, it, expect } from 'vitest'
import { distToSegment, strokeHit, ERASE_RADIUS } from './draw'

describe('distToSegment', () => {
  it('선분 가운데에 수직으로 떨어진 거리를 잰다', () => {
    expect(distToSegment(50, 10, 0, 0, 100, 0)).toBe(10)
  })

  it('선분 밖으로 나가면 끝점까지의 거리다 (무한 직선이 아니다)', () => {
    expect(distToSegment(200, 0, 0, 0, 100, 0)).toBe(100)
  })

  it('길이 0인 선분은 그 점까지의 거리다 (0으로 나누지 않는다)', () => {
    expect(distToSegment(3, 4, 0, 0, 0, 0)).toBe(5)
  })
})

describe('strokeHit — 지우개 판정 [회귀]', () => {
  // 버그: 처음엔 선을 이루는 '점'과의 거리만 쟀다. 빠르게 그으면 점이 듬성듬성
  // 찍히는데, 그 사이 구간을 문질러도 안 지워졌다. 손가락으로 빠르게 그을수록 심했다.
  // 고친 뒤로는 점이 아니라 '선분'과의 거리로 판정한다.
  const W = 900
  const H = 400
  // 두 점 사이가 멀리 떨어진 선 (빠르게 그은 상황)
  const sparse = { points: [[0.1, 0.5], [0.9, 0.5]] }

  it('점에서 멀지만 선분 위인 지점을 문지르면 지워진다', () => {
    // 중간 지점 (x=0.5) — 양 끝점에서 각각 360px 떨어져 있어 점 판정으로는 안 걸린다
    expect(strokeHit(sparse, 0.5 * W, 0.5 * H, W, H)).toBe(true)
  })

  it('점 판정이었다면 놓쳤을 거리임을 확인한다', () => {
    const pts = sparse.points.map(([x, y]) => [x * W, y * H])
    const mid = [0.5 * W, 0.5 * H]
    const nearestPoint = Math.min(...pts.map(([x, y]) => Math.hypot(x - mid[0], y - mid[1])))
    expect(nearestPoint).toBeGreaterThan(ERASE_RADIUS) // 점으로는 절대 못 잡는다
  })

  it('선에서 충분히 떨어지면 안 지워진다', () => {
    expect(strokeHit(sparse, 0.5 * W, 0.5 * H + 40, W, H)).toBe(false)
  })

  it('판정 반경 경계 안쪽은 지워진다', () => {
    expect(strokeHit(sparse, 0.5 * W, 0.5 * H + ERASE_RADIUS - 1, W, H)).toBe(true)
  })

  it('점 하나짜리 선(탭으로 찍은 점)도 지워진다', () => {
    const dot = { points: [[0.5, 0.5]] }
    expect(strokeHit(dot, 0.5 * W, 0.5 * H, W, H)).toBe(true)
    expect(strokeHit(dot, 0.5 * W + 100, 0.5 * H, W, H)).toBe(false)
  })

  it('추세선(점 2개)도 같은 규칙으로 지워진다', () => {
    const line = { points: [[0.2, 0.8], [0.8, 0.2]] }
    expect(strokeHit(line, 0.5 * W, 0.5 * H, W, H)).toBe(true)
  })

  it('가로·세로 축척이 달라도 픽셀 기준으로 판정한다', () => {
    // 정규화 좌표로 그냥 비교하면 납작한 플롯에서 판정이 왜곡된다
    const flat = { points: [[0.5, 0.5], [0.5, 0.5]] }
    // x로 20px 떨어진 지점 — W가 크든 작든 20px는 20px여야 한다
    expect(strokeHit(flat, 0.5 * 2000 + 20, 0.5 * 100, 2000, 100)).toBe(false)
    expect(strokeHit(flat, 0.5 * 2000 + 10, 0.5 * 100, 2000, 100)).toBe(true)
  })
})
