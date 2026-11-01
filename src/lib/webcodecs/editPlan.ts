import type { MbAudioCodec, MbVideoCodec } from '../exportCodecs'
import type { Framerate, Quality } from '../types'
import type { ExportJob, JobSlice } from './protocol'

export type EditSlice = JobSlice & {
  // Where this slice begins on the continuous output timeline (microseconds).
  outStartTimestampUs: number
}

export type EditPlan = {
  outputWidth: number
  outputHeight: number
  slices: EditSlice[]
  // null means "original": pass source frame timing through unchanged.
  frameDurationUs: number | null
  // Exact output frame rate for constant-rate output; null for "original".
  frameRate: number | null
  videoBitrate: number
  audioBitrate: number
  keyFrameIntervalUs: number
  videoCodec: MbVideoCodec
  audioCodec: MbAudioCodec
  hasAudioOutput: boolean
}

const FPS_BY_PRESET: Record<Exclude<Framerate, 'original'>, number> = {
  '60': 60,
  '30': 30,
  '24': 24,
}

// 1080p reference video bitrates (bits/sec), scaled linearly by pixel count.
// These are tunable starting points; tests assert ordering and scaling, not
// exact magnitudes.
const VIDEO_BITRATE_1080P: Record<Quality, number> = {
  lossless: 40_000_000,
  high: 12_000_000,
  medium: 6_000_000,
  low: 2_500_000,
}

const AUDIO_BITRATE: Record<Quality, number> = {
  lossless: 128_000,
  high: 128_000,
  medium: 96_000,
  low: 64_000,
}

const KEYFRAME_INTERVAL_US = 2_000_000
const REF_PIXELS = 1920 * 1080
const MIN_VIDEO_BITRATE = 100_000

export type EncodeParams = {
  frameDurationUs: number | null
  frameRate: number | null
  videoBitrate: number
  audioBitrate: number
  keyFrameIntervalUs: number
}

// Shared encode parameters derived from output dimensions, fps, and quality.
// Used by both the Basic edit plan and the Advanced compositor plan.
export function computeEncodeParams(
  width: number,
  height: number,
  fps: Framerate,
  quality: Quality
): EncodeParams {
  const frameRate = fps === 'original' ? null : FPS_BY_PRESET[fps]
  const frameDurationUs = frameRate === null ? null : Math.round(1_000_000 / frameRate)
  const pixelRatio = (width * height) / REF_PIXELS
  const videoBitrate = Math.max(
    MIN_VIDEO_BITRATE,
    Math.round(VIDEO_BITRATE_1080P[quality] * pixelRatio)
  )
  return {
    frameDurationUs,
    frameRate,
    videoBitrate,
    audioBitrate: AUDIO_BITRATE[quality],
    keyFrameIntervalUs: KEYFRAME_INTERVAL_US,
  }
}

// Codecs reject odd dimensions for yuv420; floor to even (minimum 2).
export function evenFloor(value: number): number {
  const floored = Math.max(2, Math.floor(value))
  return floored % 2 === 0 ? floored : floored - 1
}

// The frame size one slice shows: its crop, or the whole source.
function sliceFrameSize(job: ExportJob, slice: JobSlice): { width: number; height: number } {
  if (slice.crop && slice.crop.width > 0 && slice.crop.height > 0) {
    return { width: slice.crop.width, height: slice.crop.height }
  }
  const source = job.sources[slice.sourceIndex]
  return { width: source?.width ?? 0, height: source?.height ?? 0 }
}

// Output frame size. The first segment sets the aspect ratio, like a sequence
// taking its settings from its first clip; the resolution is the largest
// segment with that same aspect ratio, so mixing 720p and 1080p of the same
// shape exports at 1080p. Every segment is contain-fitted into the frame
// (letterboxed/pillarboxed), so mixed aspect ratios never stretch.
const ASPECT_TOLERANCE = 0.01

export function outputDimensions(job: ExportJob): { width: number; height: number } {
  const first = job.slices[0]
  if (!first) return { width: 2, height: 2 }
  let best = sliceFrameSize(job, first)
  if (best.width <= 0 || best.height <= 0) return { width: 2, height: 2 }
  const aspect = best.width / best.height
  for (const slice of job.slices) {
    const size = sliceFrameSize(job, slice)
    if (size.width <= 0 || size.height <= 0) continue
    const sameShape = Math.abs(size.width / size.height - aspect) <= aspect * ASPECT_TOLERANCE
    if (sameShape && size.width * size.height > best.width * best.height) best = size
  }
  return { width: evenFloor(best.width), height: evenFloor(best.height) }
}

export function buildEditPlan(job: ExportJob): EditPlan {
  const { width, height } = outputDimensions(job)

  let cursorUs = 0
  const slices: EditSlice[] = job.slices.map((slice) => {
    const withStart: EditSlice = { ...slice, outStartTimestampUs: cursorUs }
    const durationUs = Math.round((slice.sourceEnd - slice.sourceStart) * 1_000_000)
    cursorUs += durationUs
    return withStart
  })

  const params = computeEncodeParams(width, height, job.fps, job.quality)

  const hasAudioOutput = job.slices.some(
    (slice) => job.sources[slice.sourceIndex]?.hasAudio === true
  )

  return {
    outputWidth: width,
    outputHeight: height,
    slices,
    frameDurationUs: params.frameDurationUs,
    frameRate: params.frameRate,
    videoBitrate: params.videoBitrate,
    audioBitrate: params.audioBitrate,
    keyFrameIntervalUs: params.keyFrameIntervalUs,
    videoCodec: job.videoCodec,
    audioCodec: job.audioCodec,
    hasAudioOutput,
  }
}
