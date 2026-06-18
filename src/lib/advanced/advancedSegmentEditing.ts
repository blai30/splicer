import { fitRect } from '@/lib/advanced/fit'
import {
  advancedCanvas,
  advancedSegments,
  advancedSelectedId,
  clips,
  getClipById,
} from '@/lib/store'
import type { Clip } from '@/lib/types'

export function addClipToTrack(clip: Clip, trackId: string, timelineStart: number): string {
  if (!getClipById(clip.id)) clips.value = [...clips.value, clip]
  const canvas = advancedCanvas.value
  const segment = {
    id: crypto.randomUUID(),
    clipId: clip.id,
    trackId,
    timelineStart: Math.max(0, timelineStart),
    sourceStart: 0,
    sourceEnd: clip.duration,
    transform: fitRect(clip.width, clip.height, canvas.width, canvas.height),
  }
  advancedSegments.value = [...advancedSegments.value, segment]
  advancedSelectedId.value = segment.id
  return segment.id
}

export function moveSegment(id: string, trackId: string, timelineStart: number): void {
  advancedSegments.value = advancedSegments.value.map((segment) =>
    segment.id === id
      ? { ...segment, trackId, timelineStart: Math.max(0, timelineStart) }
      : segment
  )
}

export function removeAdvancedSegment(id: string): void {
  advancedSegments.value = advancedSegments.value.filter((segment) => segment.id !== id)
  if (advancedSelectedId.value === id) {
    advancedSelectedId.value = advancedSegments.value[0]?.id ?? null
  }
}

export function selectAdvancedSegment(id: string): void {
  advancedSelectedId.value = id
}
