import type { Transform } from '@/lib/types'

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export const MIN_TRANSFORM_SIZE = 16

function movesLeft(handle: ResizeHandle): boolean {
  return handle === 'nw' || handle === 'w' || handle === 'sw'
}
function movesRight(handle: ResizeHandle): boolean {
  return handle === 'ne' || handle === 'e' || handle === 'se'
}
function movesTop(handle: ResizeHandle): boolean {
  return handle === 'nw' || handle === 'n' || handle === 'ne'
}
function movesBottom(handle: ResizeHandle): boolean {
  return handle === 'sw' || handle === 's' || handle === 'se'
}

function isCorner(handle: ResizeHandle): boolean {
  return handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw'
}

// Resize a transform by dragging one handle by (dx, dy) canvas pixels. Edges
// move the dragged side; corners move two sides. Sizes clamp to a minimum
// rather than inverting. With lockAspect on a corner, the dragged corner moves
// along the original aspect ratio, anchored at the opposite corner.
export function resizeTransform(
  transform: Transform,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  lockAspect: boolean
): Transform {
  let left = transform.x
  let right = transform.x + transform.width
  let top = transform.y
  let bottom = transform.y + transform.height

  if (movesLeft(handle)) left = Math.min(left + dx, right - MIN_TRANSFORM_SIZE)
  if (movesRight(handle)) right = Math.max(right + dx, left + MIN_TRANSFORM_SIZE)
  if (movesTop(handle)) top = Math.min(top + dy, bottom - MIN_TRANSFORM_SIZE)
  if (movesBottom(handle)) bottom = Math.max(bottom + dy, top + MIN_TRANSFORM_SIZE)

  let width = right - left
  let height = bottom - top

  if (lockAspect && isCorner(handle)) {
    // Follow whichever axis moved further relative to the box, so a mostly
    // vertical drag resizes as well as a horizontal one. Keep the anchor corner
    // (the one opposite the dragged handle) fixed.
    const widthScale = width / transform.width
    const heightScale = height / transform.height
    const minScale = MIN_TRANSFORM_SIZE / Math.min(transform.width, transform.height)
    const scale = Math.max(
      minScale,
      Math.abs(heightScale - 1) > Math.abs(widthScale - 1) ? heightScale : widthScale
    )
    width = transform.width * scale
    height = transform.height * scale
    if (movesLeft(handle)) left = right - width
    else right = left + width
    if (movesTop(handle)) top = bottom - height
    else bottom = top + height
  }

  return { x: left, y: top, width: right - left, height: bottom - top }
}
