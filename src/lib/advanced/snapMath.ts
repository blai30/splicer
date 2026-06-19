import type { Transform } from '@/lib/types'

export type SnapResult = {
  x: number
  y: number
  guideX: number | null
  guideY: number | null
}

// Candidate snap lines on the infinite canvas: the world origin on each axis,
// plus every other box's left/center/right and top/center/bottom.
export function snapCandidates(others: Transform[]): {
  vertical: number[]
  horizontal: number[]
} {
  const vertical = [0]
  const horizontal = [0]
  for (const box of others) {
    vertical.push(box.x, box.x + box.width / 2, box.x + box.width)
    horizontal.push(box.y, box.y + box.height / 2, box.y + box.height)
  }
  return { vertical, horizontal }
}

// Try to snap the box's left/center/right to a vertical candidate and its
// top/center/bottom to a horizontal candidate, choosing the smallest in-range
// delta per axis. Returns the snapped top-left and the snapped guide lines.
export function snapMove(
  box: Transform,
  candidates: { vertical: number[]; horizontal: number[] },
  threshold: number
): SnapResult {
  const xPoints = [box.x, box.x + box.width / 2, box.x + box.width]
  const yPoints = [box.y, box.y + box.height / 2, box.y + box.height]

  let bestDx = 0
  let bestX = Infinity
  let guideX: number | null = null
  for (const point of xPoints) {
    for (const line of candidates.vertical) {
      const delta = line - point
      if (Math.abs(delta) <= threshold && Math.abs(delta) < bestX) {
        bestX = Math.abs(delta)
        bestDx = delta
        guideX = line
      }
    }
  }

  let bestDy = 0
  let bestY = Infinity
  let guideY: number | null = null
  for (const point of yPoints) {
    for (const line of candidates.horizontal) {
      const delta = line - point
      if (Math.abs(delta) <= threshold && Math.abs(delta) < bestY) {
        bestY = Math.abs(delta)
        bestDy = delta
        guideY = line
      }
    }
  }

  return { x: box.x + bestDx, y: box.y + bestDy, guideX, guideY }
}
