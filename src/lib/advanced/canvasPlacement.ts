import { visibleAdvancedSegments } from '@/lib/advanced/advancedExport'
import { placeSegment } from '@/lib/advanced/advancedSegmentEditing'
import { defaultCrop } from '@/lib/advanced/cropMath'
import { computeFrameScenes, frameRectForSegment } from '@/lib/advanced/exportLayout'
import { coverCrop, fitRect } from '@/lib/advanced/fit'
import type { WorldRect } from '@/lib/advanced/viewportMath'
import { advancedOutputLock, advancedSegments, getClipById } from '@/lib/store'
import type { AdvancedSegment, CropParams, Transform } from '@/lib/types'

export type Placement = { transform: Transform; crop?: CropParams }

// Fit: the clip, at its current aspect, as large as the frame allows and
// centered in it (letterboxed on one axis when the shapes differ).
export function fitPlacement(segment: AdvancedSegment, frame: WorldRect): Placement {
  const box = fitRect(segment.transform.width, segment.transform.height, frame.width, frame.height)
  return { transform: { ...box, x: frame.minX + box.x, y: frame.minY + box.y } }
}

// Fill: the clip covers the whole frame. Instead of stretching, the source is
// cropped (centered, within any crop already set) to the frame's shape.
export function fillPlacement(
  segment: AdvancedSegment,
  frame: WorldRect,
  sourceSize: { width: number; height: number }
): Placement {
  const current = segment.crop ?? defaultCrop(sourceSize.width, sourceSize.height)
  return {
    transform: { x: frame.minX, y: frame.minY, width: frame.width, height: frame.height },
    crop: coverCrop(current, frame.width / frame.height),
  }
}

const PLACEMENT_EPSILON = 1e-6

export function placementChanges(segment: AdvancedSegment, placement: Placement): boolean {
  const differs = (first: Record<string, number>, second: Record<string, number>) =>
    Object.keys(second).some((key) => Math.abs(first[key] - second[key]) > PLACEMENT_EPSILON)
  if (differs(segment.transform, placement.transform)) return true
  if (!placement.crop) return false
  return !segment.crop || differs(segment.crop, placement.crop)
}

// The output frame the clip exports in, as the dashed frame shows it.
export function outputFrameOf(segmentId: string): WorldRect | null {
  return frameRectForSegment(
    visibleAdvancedSegments(advancedSegments.value),
    advancedOutputLock.value,
    segmentId
  )
}

export function plannedPlacement(segmentId: string, mode: 'fit' | 'fill'): Placement | null {
  const segment = advancedSegments.value.find((entry) => entry.id === segmentId)
  const frame = outputFrameOf(segmentId)
  if (!segment || !frame || frame.width <= 0 || frame.height <= 0) return null
  if (mode === 'fit') return fitPlacement(segment, frame)
  const clip = getClipById(segment.clipId)
  if (!clip) return null
  return fillPlacement(segment, frame, clip)
}

export function placeInOutput(segmentId: string, mode: 'fit' | 'fill'): void {
  const placement = plannedPlacement(segmentId, mode)
  if (placement) placeSegment(segmentId, placement.transform, placement.crop)
}

// The output frame worth snapping to while `movingIds` move or resize. The
// frame is fitted around its scene's clips, so when only moving clips make it
// up it would travel with them: then there is none.
export function snapFrameFor(anchorId: string, movingIds: ReadonlySet<string>): WorldRect | null {
  const scene = computeFrameScenes(
    visibleAdvancedSegments(advancedSegments.value),
    advancedOutputLock.value
  ).find((entry) => entry.segmentIds.includes(anchorId))
  if (!scene || scene.segmentIds.every((id) => movingIds.has(id))) return null
  return scene.rect
}
