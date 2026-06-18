import { ADV_MIN_SEGMENT_DURATION } from '@/lib/advanced/advancedTimelineDomain'
import { fitRect } from '@/lib/advanced/fit'
import {
  advancedCanvas,
  advancedSegments,
  advancedSelectedId,
  clips,
  getClipById,
} from '@/lib/store'
import type { Clip, CropParams, Transform } from '@/lib/types'

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
    segment.id === id ? { ...segment, trackId, timelineStart: Math.max(0, timelineStart) } : segment
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

export function trimSegmentStart(id: string, nextSourceStart: number): void {
  advancedSegments.value = advancedSegments.value.map((segment) => {
    if (segment.id !== id) return segment
    const clamped = Math.min(
      segment.sourceEnd - ADV_MIN_SEGMENT_DURATION,
      Math.max(0, nextSourceStart)
    )
    const delta = clamped - segment.sourceStart
    return {
      ...segment,
      sourceStart: clamped,
      timelineStart: Math.max(0, segment.timelineStart + delta),
    }
  })
}

export function trimSegmentEnd(id: string, nextSourceEnd: number): void {
  advancedSegments.value = advancedSegments.value.map((segment) => {
    if (segment.id !== id) return segment
    const clip = getClipById(segment.clipId)
    const maxEnd = clip?.duration ?? segment.sourceEnd
    const clamped = Math.min(
      maxEnd,
      Math.max(segment.sourceStart + ADV_MIN_SEGMENT_DURATION, nextSourceEnd)
    )
    return { ...segment, sourceEnd: clamped }
  })
}

// Split at an absolute timeline time. The first part keeps the head; the second
// part starts at the split with the matching source offset.
export function splitAdvancedSegment(id: string, atGlobalTime: number): string | null {
  const segment = advancedSegments.value.find((entry) => entry.id === id)
  if (!segment) return null
  const localTime = atGlobalTime - segment.timelineStart
  const sourceSplit = segment.sourceStart + localTime
  if (sourceSplit <= segment.sourceStart || sourceSplit >= segment.sourceEnd) return null

  const newId = crypto.randomUUID()
  const first = { ...segment, sourceEnd: sourceSplit }
  const second = {
    ...segment,
    id: newId,
    sourceStart: sourceSplit,
    timelineStart: atGlobalTime,
  }
  advancedSegments.value = advancedSegments.value.flatMap((entry) =>
    entry.id === id ? [first, second] : [entry]
  )
  return newId
}

export function setSegmentTransform(id: string, transform: Transform): void {
  advancedSegments.value = advancedSegments.value.map((segment) =>
    segment.id === id ? { ...segment, transform } : segment
  )
}

export function setSegmentCrop(id: string, crop: CropParams | undefined): void {
  advancedSegments.value = advancedSegments.value.map((segment) =>
    segment.id === id ? { ...segment, crop } : segment
  )
}

export function toggleSegmentMute(id: string): void {
  advancedSegments.value = advancedSegments.value.map((segment) =>
    segment.id === id ? { ...segment, muted: !segment.muted } : segment
  )
}
