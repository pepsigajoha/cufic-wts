// 그리기 기하 계산. 순수 함수만 둔다 (DrawLayer가 쓰고, 테스트가 직접 검사한다).

/** 지우개 판정 반경(px) */
export const ERASE_RADIUS = 14

/** 점(px,py)에서 선분(x1,y1)-(x2,y2)까지의 최단거리 */
export function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  // 선분 위 가장 가까운 지점의 매개변수 t를 [0,1]로 자른다
  const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/**
 * 지우개가 이 선에 닿았는지.
 *
 * 점이 아니라 점과 점을 잇는 '선분'과의 거리로 판정한다 —
 * 빠르게 그으면 점이 듬성듬성 찍히므로, 점만 보면 그 사이 구간이 안 지워진다.
 * 정규화 좌표는 x·y 축척이 달라 거리 비교가 왜곡되므로 픽셀로 되돌려 계산한다.
 *
 * @param {{points:[number,number][]}} stroke  좌표는 0~1 정규화
 * @param {number} ex  지우개 x (px)
 * @param {number} ey  지우개 y (px)
 * @param {number} w   플롯 너비(px)
 * @param {number} h   플롯 높이(px)
 */
export function strokeHit(stroke, ex, ey, w, h, radius = ERASE_RADIUS) {
  const pts = stroke.points.map(([x, y]) => [x * w, y * h])
  if (pts.length === 1) return Math.hypot(pts[0][0] - ex, pts[0][1] - ey) <= radius
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1]
    const [x2, y2] = pts[i]
    if (distToSegment(ex, ey, x1, y1, x2, y2) <= radius) return true
  }
  return false
}
