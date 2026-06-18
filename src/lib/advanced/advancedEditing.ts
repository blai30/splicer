import { fitRect } from '@/lib/advanced/fit'
import {
  advancedCanvas,
  advancedPlayhead,
  advancedSegments,
  advancedSelectedId,
  advancedTracks,
  clips,
  getClipById,
} from '@/lib/store'
import type { Clip } from '@/lib/types'

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

// Place a clip as the project's single segment (Phase 1 is single-clip), adding
// it to the shared library if needed and fitting it to the canvas.
export function setAdvancedClip(clip: Clip): string {
  if (!getClipById(clip.id)) clips.value = [...clips.value, clip]
  const canvas = advancedCanvas.value
  const segment = {
    id: crypto.randomUUID(),
    clipId: clip.id,
    trackId: advancedTracks.value[0]?.id ?? 'track-1',
    timelineStart: 0,
    sourceStart: 0,
    sourceEnd: clip.duration,
    transform: fitRect(clip.width, clip.height, canvas.width, canvas.height),
  }
  advancedSegments.value = [segment]
  advancedSelectedId.value = segment.id
  advancedPlayhead.value = 0
  return segment.id
}

export function clearAdvancedClip(): void {
  advancedSegments.value = []
  advancedSelectedId.value = null
  advancedPlayhead.value = 0
}
