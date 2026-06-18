import type { WorldRect } from '@/lib/advanced/viewportMath'
import type { AdvancedSegment, CanvasSize, Transform } from '@/lib/types'

const OUTPUT_MIN = 16
const OUTPUT_MAX = 7680

// Codecs reject odd dimensions for yuv420; clamp to an even integer in range.
function clampEven(value: number): number {
  const bounded = Math.min(OUTPUT_MAX, Math.max(OUTPUT_MIN, Math.round(value)))
  return bounded % 2 === 0 ? bounded : bounded - 1
}

// Tight union of every segment's destination rect, in world pixels.
export function computeContentBounds(segments: AdvancedSegment[]): WorldRect | null {
  if (segments.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const segment of segments) {
    const { x, y, width, height } = segment.transform
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + width)
    maxY = Math.max(maxY, y + height)
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY }
}

export type ExportBounds = {
  width: number
  height: number
  mapTransform: (transform: Transform) => Transform
}

// Resolve the output dimensions and the world->output transform mapping.
// Auto (lock === null): output is the even-clamped bbox; content shifts flush to
// the origin. Locked: output is the locked size; content is contain-scaled and
// centered (black letterbox bars fill the remainder at encode time).
export function computeExportBounds(
  segments: AdvancedSegment[],
  lock: CanvasSize | null
): ExportBounds | null {
  const bounds = computeContentBounds(segments)
  if (!bounds) return null

  if (lock === null) {
    const { minX, minY } = bounds
    return {
      width: clampEven(bounds.width),
      height: clampEven(bounds.height),
      mapTransform: (transform) => ({
        ...transform,
        x: transform.x - minX,
        y: transform.y - minY,
      }),
    }
  }

  const width = clampEven(lock.width)
  const height = clampEven(lock.height)
  const scale = Math.min(width / bounds.width, height / bounds.height)
  const offsetX = (width - bounds.width * scale) / 2
  const offsetY = (height - bounds.height * scale) / 2
  return {
    width,
    height,
    mapTransform: (transform) => ({
      x: (transform.x - bounds.minX) * scale + offsetX,
      y: (transform.y - bounds.minY) * scale + offsetY,
      width: transform.width * scale,
      height: transform.height * scale,
    }),
  }
}

// World-space rect that previews what will be exported (the dashed indicator).
// Auto: the content bbox. Locked: the bbox expanded to the locked aspect ratio,
// centered, so the letterbox framing is visible on the infinite canvas.
export function computeFrameRect(
  segments: AdvancedSegment[],
  lock: CanvasSize | null
): WorldRect | null {
  const bounds = computeContentBounds(segments)
  if (!bounds) return null
  if (lock === null) return bounds

  const lockAspect = lock.width / lock.height
  const boundsAspect = bounds.width / bounds.height
  let width = bounds.width
  let height = bounds.height
  if (boundsAspect > lockAspect) {
    height = width / lockAspect
  } else {
    width = height * lockAspect
  }
  return {
    minX: bounds.minX - (width - bounds.width) / 2,
    minY: bounds.minY - (height - bounds.height) / 2,
    width,
    height,
  }
}
