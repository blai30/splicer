import { resizeTransform, type ResizeHandle } from '@/lib/advanced/transformMath'
import type { WorldRect } from '@/lib/advanced/viewportMath'
import type { Transform } from '@/lib/types'

export type SnapResult = {
  x: number
  y: number
  guideX: number | null
  guideY: number | null
}

export type SnapCandidates = { vertical: number[]; horizontal: number[] }

// Candidate snap lines on the infinite canvas: the world origin on each axis,
// every other box's left/center/right and top/center/bottom, and the output
// frame's edges and center when there is one.
export function snapCandidates(
  others: Transform[],
  frame: WorldRect | null = null
): SnapCandidates {
  const vertical = [0]
  const horizontal = [0]
  const boxes = frame
    ? [...others, { x: frame.minX, y: frame.minY, width: frame.width, height: frame.height }]
    : others
  for (const box of boxes) {
    vertical.push(box.x, box.x + box.width / 2, box.x + box.width)
    horizontal.push(box.y, box.y + box.height / 2, box.y + box.height)
  }
  return { vertical, horizontal }
}

// The candidate line nearest to `edge` within `threshold`, or null.
function nearestLine(
  edge: number,
  lines: number[],
  threshold: number
): { line: number; delta: number } | null {
  let best: { line: number; delta: number } | null = null
  for (const line of lines) {
    const delta = line - edge
    if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
      best = { line, delta }
    }
  }
  return best
}

export type ResizeSnapResult = {
  transform: Transform
  guideX: number | null
  guideY: number | null
}

// Resize by dragging `handle` by (dx, dy), snapping only the edges that
// handle moves to the candidate lines. With the aspect locked (corners) the
// closer of the two moving edges snaps and the other follows the aspect.
export function snapResize(
  start: Transform,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  lockAspect: boolean,
  candidates: SnapCandidates,
  threshold: number
): ResizeSnapResult {
  const raw = resizeTransform(start, handle, dx, dy, lockAspect)
  const movesLeft = handle.includes('w')
  const movesRight = handle.includes('e')
  const movesTop = handle.includes('n')
  const movesBottom = handle.includes('s')
  const xEdge = movesLeft ? raw.x : movesRight ? raw.x + raw.width : null
  const yEdge = movesTop ? raw.y : movesBottom ? raw.y + raw.height : null
  const xSnap = xEdge === null ? null : nearestLine(xEdge, candidates.vertical, threshold)
  const ySnap = yEdge === null ? null : nearestLine(yEdge, candidates.horizontal, threshold)
  const corner = xEdge !== null && yEdge !== null

  let transform: Transform
  if (lockAspect && corner) {
    // Resize to a uniform scale: moving both edges consistently means the
    // locked resize follows that scale whichever axis it would otherwise pick.
    const scaled = (scale: number) => {
      const widthDelta = start.width * (scale - 1)
      const heightDelta = start.height * (scale - 1)
      return resizeTransform(
        start,
        handle,
        movesRight ? widthDelta : -widthDelta,
        movesBottom ? heightDelta : -heightDelta,
        true
      )
    }
    const useX =
      xSnap !== null && (ySnap === null || Math.abs(xSnap.delta) <= Math.abs(ySnap.delta))
    if (useX) {
      const width = movesRight ? xSnap.line - raw.x : raw.x + raw.width - xSnap.line
      transform = scaled(width / start.width)
    } else if (ySnap) {
      const height = movesBottom ? ySnap.line - raw.y : raw.y + raw.height - ySnap.line
      transform = scaled(height / start.height)
    } else {
      transform = raw
    }
  } else {
    transform = resizeTransform(
      start,
      handle,
      dx + (xSnap?.delta ?? 0),
      dy + (ySnap?.delta ?? 0),
      lockAspect
    )
  }

  // Show a guide only where an edge really landed (the minimum size or the
  // aspect can keep it short of the line).
  const landed = (value: number | null, line: number | undefined) =>
    value !== null && line !== undefined && Math.abs(value - line) < 1e-6 ? line : null
  const finalX = movesLeft ? transform.x : movesRight ? transform.x + transform.width : null
  const finalY = movesTop ? transform.y : movesBottom ? transform.y + transform.height : null
  return {
    transform,
    guideX: landed(finalX, xSnap?.line),
    guideY: landed(finalY, ySnap?.line),
  }
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
