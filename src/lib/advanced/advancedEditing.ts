import {
  advancedOutputLock,
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

// Lock the export output to a fixed size (Auto off). Clamped to even integers.
export function setOutputLock(width: number, height: number): void {
  advancedOutputLock.value = { width: clampDimension(width), height: clampDimension(height) }
}

// Return to Auto (output = bounding box of placed clips).
export function clearOutputLock(): void {
  advancedOutputLock.value = null
}

export function clearAdvancedClip(): void {
  advancedSegments.value = []
  advancedSelectedId.value = null
  advancedPlayhead.value = 0
}
