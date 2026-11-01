import type { CropParams, Transform } from '@/lib/types'

// Contain-fit a source rectangle inside a destination rectangle, preserving
// aspect ratio and centering. Returns the destination-space box to draw into.
export function fitRect(
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number
): Transform {
  if (srcWidth <= 0 || srcHeight <= 0) {
    return { x: 0, y: 0, width: dstWidth, height: dstHeight }
  }
  const scale = Math.min(dstWidth / srcWidth, dstHeight / srcHeight)
  const width = srcWidth * scale
  const height = srcHeight * scale
  return { x: (dstWidth - width) / 2, y: (dstHeight - height) / 2, width, height }
}

// The largest crop of `crop` with the given aspect (width / height), centered,
// so a clip can fill a frame of that shape without stretching.
export function coverCrop(crop: CropParams, aspect: number): CropParams {
  if (!(aspect > 0) || crop.width <= 0 || crop.height <= 0) return crop
  if (crop.width / crop.height > aspect) {
    const width = crop.height * aspect
    return { ...crop, x: crop.x + (crop.width - width) / 2, width }
  }
  const height = crop.width / aspect
  return { ...crop, y: crop.y + (crop.height - height) / 2, height }
}
