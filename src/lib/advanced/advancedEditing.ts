import { recordAdvancedHistory } from '@/lib/advanced/advancedHistory'
import { clearAdvancedSelection } from '@/lib/advanced/advancedSelection'
import { advancedOutputLock, advancedPlayhead, advancedSegments } from '@/lib/store'

export const CANVAS_MIN = 16
export const CANVAS_MAX = 7680

// Codecs reject odd dimensions for yuv420; clamp to an even integer in range.
function clampDimension(value: number): number {
  const bounded = Math.min(CANVAS_MAX, Math.max(CANVAS_MIN, Math.round(value)))
  return bounded % 2 === 0 ? bounded : bounded - 1
}

// Lock the export output to a fixed size (Auto off). Clamped to even integers.
export function setOutputLock(width: number, height: number): void {
  const next = { width: clampDimension(width), height: clampDimension(height) }
  const current = advancedOutputLock.value
  if (current && current.width === next.width && current.height === next.height) return
  recordAdvancedHistory()
  advancedOutputLock.value = next
}

// Return to Auto (output = bounding box of placed clips).
export function clearOutputLock(): void {
  if (advancedOutputLock.value === null) return
  recordAdvancedHistory()
  advancedOutputLock.value = null
}

export function clearAdvancedClip(): void {
  advancedSegments.value = []
  clearAdvancedSelection()
  advancedPlayhead.value = 0
}
