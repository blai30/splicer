import type { ResizeHandle } from '@/lib/advanced/transformMath'
import type { CropParams } from '@/lib/types'

export const MIN_CROP_SIZE = 8

export function defaultCrop(sourceWidth: number, sourceHeight: number): CropParams {
  return { x: 0, y: 0, width: sourceWidth, height: sourceHeight }
}

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

// Resize the source crop rectangle by dragging one handle by (dxSource,
// dySource) source pixels, clamped to the source frame and a minimum size.
export function resizeCrop(
  crop: CropParams,
  handle: ResizeHandle,
  dxSource: number,
  dySource: number,
  sourceWidth: number,
  sourceHeight: number
): CropParams {
  let left = crop.x
  let right = crop.x + crop.width
  let top = crop.y
  let bottom = crop.y + crop.height

  if (movesLeft(handle)) left = Math.min(Math.max(0, left + dxSource), right - MIN_CROP_SIZE)
  if (movesRight(handle))
    right = Math.max(Math.min(sourceWidth, right + dxSource), left + MIN_CROP_SIZE)
  if (movesTop(handle)) top = Math.min(Math.max(0, top + dySource), bottom - MIN_CROP_SIZE)
  if (movesBottom(handle))
    bottom = Math.max(Math.min(sourceHeight, bottom + dySource), top + MIN_CROP_SIZE)

  return { x: left, y: top, width: right - left, height: bottom - top }
}
