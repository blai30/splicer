import { fitRect } from '@/lib/advanced/fit'
import {
  advancedCanvas,
  advancedPlayhead,
  advancedSegments,
  advancedSelectedId,
  getClipById,
} from '@/lib/store'

export const CANVAS_MIN = 16
export const CANVAS_MAX = 7680

// Codecs reject odd dimensions for yuv420; clamp to an even integer in range.
function clampDimension(value: number): number {
  const bounded = Math.min(CANVAS_MAX, Math.max(CANVAS_MIN, Math.round(value)))
  return bounded % 2 === 0 ? bounded : bounded - 1
}

// Resize the output canvas. With no manual transform editing yet, the placed
// clip re-fits to the new canvas.
export function setCanvasSize(width: number, height: number): void {
  const next = { width: clampDimension(width), height: clampDimension(height) }
  advancedCanvas.value = next
  advancedSegments.value = advancedSegments.value.map((segment) => {
    const clip = getClipById(segment.clipId)
    if (!clip) return segment
    return { ...segment, transform: fitRect(clip.width, clip.height, next.width, next.height) }
  })
}

export function clearAdvancedClip(): void {
  advancedSegments.value = []
  advancedSelectedId.value = null
  advancedPlayhead.value = 0
}
