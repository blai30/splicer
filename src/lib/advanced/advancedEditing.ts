import {
  advancedCanvas,
  advancedPlayhead,
  advancedSegments,
  advancedSelectedId,
} from '@/lib/store'

export const CANVAS_MIN = 16
export const CANVAS_MAX = 7680

// Codecs reject odd dimensions for yuv420; clamp to an even integer in range.
function clampDimension(value: number): number {
  const bounded = Math.min(CANVAS_MAX, Math.max(CANVAS_MIN, Math.round(value)))
  return bounded % 2 === 0 ? bounded : bounded - 1
}

// Resize the output canvas and scale each segment's transform proportionally.
export function setCanvasSize(width: number, height: number): void {
  const next = { width: clampDimension(width), height: clampDimension(height) }
  const prev = advancedCanvas.value
  const scaleX = prev.width > 0 ? next.width / prev.width : 1
  const scaleY = prev.height > 0 ? next.height / prev.height : 1
  advancedCanvas.value = next
  advancedSegments.value = advancedSegments.value.map((segment) => ({
    ...segment,
    transform: {
      x: segment.transform.x * scaleX,
      y: segment.transform.y * scaleY,
      width: segment.transform.width * scaleX,
      height: segment.transform.height * scaleY,
    },
  }))
}

export function clearAdvancedClip(): void {
  advancedSegments.value = []
  advancedSelectedId.value = null
  advancedPlayhead.value = 0
}
