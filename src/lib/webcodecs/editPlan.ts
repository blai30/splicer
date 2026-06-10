import type { Framerate, Quality, WebmCodec } from '../types'
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
  videoBitrate: number
  audioBitrate: number
  keyFrameIntervalUs: number
  videoCodec: WebmCodec
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

// Codecs reject odd dimensions for yuv420; floor to even.
function evenFloor(value: number): number {
  const floored = Math.floor(value)
  return floored % 2 === 0 ? floored : floored - 1
}

function outputDimensions(job: ExportJob): { width: number; height: number } {
  const firstCrop = job.slices[0]?.crop
  const uniformCrop =
    job.slices.length > 0 &&
    firstCrop != null &&
    job.slices.every(
      (slice) =>
        slice.crop != null &&
        slice.crop.width === firstCrop.width &&
        slice.crop.height === firstCrop.height
    )
  if (uniformCrop && firstCrop) {
    return { width: evenFloor(firstCrop.width), height: evenFloor(firstCrop.height) }
  }

  let width = 0
  let height = 0
  for (const slice of job.slices) {
    const src = job.sources[slice.sourceIndex]
    if (!src) continue
    width = Math.max(width, src.width)
    height = Math.max(height, src.height)
  }
  return { width: evenFloor(width), height: evenFloor(height) }
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

  const frameDurationUs =
    job.fps === 'original' ? null : Math.round(1_000_000 / FPS_BY_PRESET[job.fps])

  const pixelRatio = (width * height) / REF_PIXELS
  const videoBitrate = Math.max(
    MIN_VIDEO_BITRATE,
    Math.round(VIDEO_BITRATE_1080P[job.quality] * pixelRatio)
  )

  const hasAudioOutput = job.slices.some(
    (slice) => job.sources[slice.sourceIndex]?.hasAudio === true
  )

  return {
    outputWidth: width,
    outputHeight: height,
    slices,
    frameDurationUs,
    videoBitrate,
    audioBitrate: AUDIO_BITRATE[job.quality],
    keyFrameIntervalUs: KEYFRAME_INTERVAL_US,
    videoCodec: job.webmCodec,
    hasAudioOutput,
  }
}
