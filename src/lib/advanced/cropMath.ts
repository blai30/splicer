import type { ResizeHandle } from '@/lib/advanced/transformMath'
import type { CropParams, Transform } from '@/lib/types'

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

// True crop: resize the source crop rect AND the destination box together so the
// visible video keeps its current scale and position, with the dragged edge
// clipping inward/outward and the opposite edge staying fixed (no stretching).
// The source-to-canvas mapping is held constant by deriving the new box from the
// new crop using the start scale and a fixed origin.
export function resizeCropWithBox(
  transform: Transform,
  crop: CropParams,
  handle: ResizeHandle,
  dxSource: number,
  dySource: number,
  sourceWidth: number,
  sourceHeight: number
): { crop: CropParams; transform: Transform } {
  const scaleX = transform.width / crop.width
  const scaleY = transform.height / crop.height
  // Canvas position of source pixel 0 (stays fixed while only the window changes).
  const originX = transform.x - crop.x * scaleX
  const originY = transform.y - crop.y * scaleY

  const nextCrop = resizeCrop(crop, handle, dxSource, dySource, sourceWidth, sourceHeight)

  return {
    crop: nextCrop,
    transform: {
      x: originX + nextCrop.x * scaleX,
      y: originY + nextCrop.y * scaleY,
      width: nextCrop.width * scaleX,
      height: nextCrop.height * scaleY,
    },
  }
}
