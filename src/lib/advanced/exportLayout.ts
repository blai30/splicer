import { segmentEndTime } from '@/lib/advanced/advancedTimelineDomain'
import type { WorldRect } from '@/lib/advanced/viewportMath'
import type { AdvancedSegment, CanvasSize, Transform } from '@/lib/types'

const OUTPUT_MIN = 16
const OUTPUT_MAX = 7680
// Clips this close in time count as back to back, not overlapping.
const OVERLAP_EPSILON_SEC = 1e-6
// Even rounding can shave a pixel off a scene; crop it instead of resampling.
const ROUNDING_SLACK_PX = 2
// Auto output this much larger (in pixels) than the largest clip is mostly
// empty canvas, worth a warning.
const OVERSIZED_RATIO = 1.5

// Codecs reject odd dimensions for yuv420; clamp to an even integer in range.
function clampEven(value: number): number {
  const bounded = Math.min(OUTPUT_MAX, Math.max(OUTPUT_MIN, Math.round(value)))
  return bounded % 2 === 0 ? bounded : bounded - 1
}

function unionRect(transforms: Transform[]): WorldRect | null {
  if (transforms.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const { x, y, width, height } of transforms) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + width)
    maxY = Math.max(maxY, y + height)
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY }
}

// Tight union of every segment's destination rect, in world pixels.
export function computeContentBounds(segments: AdvancedSegment[]): WorldRect | null {
  return unionRect(segments.map((segment) => segment.transform))
}

// Clips that share the screen, directly or through a chain of overlaps, and
// the time span they cover together.
export type FrameScene = {
  start: number
  end: number
  bounds: WorldRect
  segmentIds: string[]
}

// Framing rule: a scene is framed by the union of its clips and that framing
// holds for as long as the scene is on screen, like a camera that does not
// move mid-shot. Clips that are never on screen together (one after another,
// with or without a gap) are separate scenes, framed on their own, so two
// clips placed side by side but played in turn do not export as one
// double-wide, half-black frame.
export function groupScenes(segments: AdvancedSegment[]): FrameScene[] {
  const ordered = [...segments].sort((first, second) => first.timelineStart - second.timelineStart)
  const groups: { start: number; end: number; members: AdvancedSegment[] }[] = []
  for (const segment of ordered) {
    const current = groups.at(-1)
    if (current && segment.timelineStart < current.end - OVERLAP_EPSILON_SEC) {
      current.members.push(segment)
      current.end = Math.max(current.end, segmentEndTime(segment))
    } else {
      groups.push({
        start: segment.timelineStart,
        end: segmentEndTime(segment),
        members: [segment],
      })
    }
  }
  return groups.map((group) => ({
    start: group.start,
    end: group.end,
    bounds: computeContentBounds(group.members) as WorldRect,
    segmentIds: group.members.map((member) => member.id),
  }))
}

function largestScene(scenes: FrameScene[]): FrameScene {
  return scenes.reduce((best, scene) =>
    scene.bounds.width * scene.bounds.height > best.bounds.width * best.bounds.height ? scene : best
  )
}

export type ExportBounds = {
  width: number
  height: number
  mapSegment: (segment: AdvancedSegment) => Transform
}

type SceneFit = { scale: number; offsetX: number; offsetY: number }

function fitScene(
  bounds: WorldRect,
  width: number,
  height: number,
  allowUpscale: boolean
): SceneFit {
  const nearlyFits =
    bounds.width <= width + ROUNDING_SLACK_PX && bounds.height <= height + ROUNDING_SLACK_PX
  const containScale = Math.min(width / bounds.width, height / bounds.height)
  const scale = allowUpscale ? containScale : nearlyFits ? 1 : Math.min(1, containScale)
  return {
    scale,
    offsetX: Math.max(0, (width - bounds.width * scale) / 2),
    offsetY: Math.max(0, (height - bounds.height * scale) / 2),
  }
}

// Resolve the output dimensions and the world->output mapping per segment.
// Auto (lock === null): the output is the largest scene's bounds (scaled down
// past the encoder limit); every scene is centered in it at 1:1, and only a
// scene that does not fit is scaled down. Locked: every scene is contain-fit
// and centered in the locked size. Black fills the rest at encode time.
export function computeExportBounds(
  segments: AdvancedSegment[],
  lock: CanvasSize | null
): ExportBounds | null {
  const scenes = groupScenes(segments)
  if (scenes.length === 0) return null

  let width: number
  let height: number
  if (lock === null) {
    const { bounds } = largestScene(scenes)
    // Content wider or taller than the encoder limit is scaled down to fit,
    // rather than cropped.
    const limitScale = Math.min(1, OUTPUT_MAX / bounds.width, OUTPUT_MAX / bounds.height)
    width = clampEven(bounds.width * limitScale)
    height = clampEven(bounds.height * limitScale)
  } else {
    width = clampEven(lock.width)
    height = clampEven(lock.height)
  }

  const fitBySegment = new Map<string, { bounds: WorldRect; fit: SceneFit }>()
  for (const scene of scenes) {
    const fit = fitScene(scene.bounds, width, height, lock !== null)
    for (const id of scene.segmentIds) fitBySegment.set(id, { bounds: scene.bounds, fit })
  }

  return {
    width,
    height,
    mapSegment: (segment) => {
      const entry = fitBySegment.get(segment.id)
      if (!entry) return segment.transform
      const { bounds, fit } = entry
      const { x, y, width: segmentWidth, height: segmentHeight } = segment.transform
      return {
        x: (x - bounds.minX) * fit.scale + fit.offsetX,
        y: (y - bounds.minY) * fit.scale + fit.offsetY,
        width: segmentWidth * fit.scale,
        height: segmentHeight * fit.scale,
      }
    },
  }
}

export type FrameRectScene = { start: number; end: number; rect: WorldRect }

// World-space rects that preview what each scene exports (the dashed
// indicator). Auto: the scene bounds. Locked: the bounds expanded to the
// locked aspect ratio, centered, so the letterbox framing is visible.
export function computeFrameScenes(
  segments: AdvancedSegment[],
  lock: CanvasSize | null
): FrameRectScene[] {
  return groupScenes(segments).map((scene) => {
    const { bounds } = scene
    if (lock === null) return { start: scene.start, end: scene.end, rect: bounds }
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
      start: scene.start,
      end: scene.end,
      rect: {
        minX: bounds.minX - (width - bounds.width) / 2,
        minY: bounds.minY - (height - bounds.height) / 2,
        width,
        height,
      },
    }
  })
}

// The scene on screen at `time`; in a gap, the one that just ended (the frame
// the viewer last saw), and before the first scene, the first.
export function sceneIndexAt(scenes: { start: number; end: number }[], time: number): number {
  let index = 0
  for (let i = 0; i < scenes.length; i++) {
    if (scenes[i].start <= time) index = i
  }
  return index
}

export function computeFrameRect(
  segments: AdvancedSegment[],
  lock: CanvasSize | null,
  time = 0
): WorldRect | null {
  const scenes = computeFrameScenes(segments, lock)
  if (scenes.length === 0) return null
  return scenes[sceneIndexAt(scenes, time)].rect
}

export type OversizedCanvas = {
  canvas: CanvasSize
  // A sensible size to lock to instead: the largest single clip.
  suggested: CanvasSize
}

// Auto output that is much larger than any one clip, because clips that play
// together are spread across the canvas. The extra area exports as black and
// raises the bitrate, so the UI offers to lock a smaller size.
export function findOversizedAutoCanvas(segments: AdvancedSegment[]): OversizedCanvas | null {
  const bounds = computeExportBounds(segments, null)
  if (!bounds || segments.length < 2) return null
  let largest: Transform | null = null
  for (const segment of segments) {
    const { width, height } = segment.transform
    if (!largest || width * height > largest.width * largest.height) largest = segment.transform
  }
  if (!largest || largest.width <= 0 || largest.height <= 0) return null
  if (bounds.width * bounds.height <= largest.width * largest.height * OVERSIZED_RATIO) return null
  return {
    canvas: { width: bounds.width, height: bounds.height },
    suggested: { width: clampEven(largest.width), height: clampEven(largest.height) },
  }
}
