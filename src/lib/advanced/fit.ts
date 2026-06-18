import type { Transform } from '@/lib/types'

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
