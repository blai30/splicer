import type { MbAudioCodec, MbVideoCodec } from '../exportCodecs'
import type { Framerate, Quality } from '../types'
import {
  coveredSourceBytes,
  fitTargetSize,
  sourceEquivalentBitrate,
  targetAudioBitrate,
  targetVideoBitrate,
  type SizeBasis,
  type SourceAudio,
  type SourceEquivalent,
  type SourceSlice,
  type TargetSizeFit,
} from './bitrateModel'
import { capShortSide, evenFloor, type Size } from './outputSize'
import type { ExportJob, JobSlice } from './protocol'

export { evenFloor } from './outputSize'

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
  // Average rate frames reach the encoder at ("original" resolved).
  nominalFrameRate: number
  sizeBasis: SizeBasis
  // Constant bitrate for target size with VP8/VP9, whose VBR undershoots or
  // overshoots a fixed size by up to a third; H.264 follows its target either way.
  bitrateMode: BitrateMode
  // How a target size was met; null for quality presets.
  targetFit: TargetSizeFit | null
}

export type BitrateMode = 'variable' | 'constant'

export function bitrateModeFor(codec: MbVideoCodec, targetSize: boolean): BitrateMode {
  return targetSize && (codec === 'vp9' || codec === 'vp8') ? 'constant' : 'variable'
}

const FPS_BY_PRESET: Record<Exclude<Framerate, 'original'>, number> = {
  '60': 60,
  '30': 30,
  '24': 24,
}

const KEYFRAME_INTERVAL_US = 2_000_000
const DEFAULT_FRAME_RATE = 30

export type EncodeParams = {
  frameDurationUs: number | null
  frameRate: number | null
  videoBitrate: number
  audioBitrate: number
  keyFrameIntervalUs: number
}

export type EncodeOptions = {
  videoCodec?: MbVideoCodec
  audioCodec?: MbAudioCodec
  // Null or absent: no usable source stats, so the codec-adjusted table applies.
  sourceEquivalent?: SourceEquivalent | null
  sourceAudio?: SourceAudio[]
}

// Shared encode parameters derived from output dimensions, fps, and quality.
// Used by both the Basic edit plan and the Advanced compositor plan.
export function computeEncodeParams(
  width: number,
  height: number,
  fps: Framerate,
  quality: Quality,
  options: EncodeOptions = {}
): EncodeParams {
  const frameRate = fps === 'original' ? null : FPS_BY_PRESET[fps]
  const frameDurationUs = frameRate === null ? null : Math.round(1_000_000 / frameRate)
  return {
    frameDurationUs,
    frameRate,
    videoBitrate: targetVideoBitrate(
      width,
      height,
      quality,
      options.videoCodec ?? 'avc',
      options.sourceEquivalent ?? null
    ),
    audioBitrate: targetAudioBitrate(
      quality,
      options.audioCodec ?? 'aac',
      options.sourceAudio ?? []
    ),
    keyFrameIntervalUs: KEYFRAME_INTERVAL_US,
  }
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
// (letterboxed/pillarboxed), so mixed aspect ratios never stretch. A
// resolution choice then caps the shorter side (job.maxShortSide).
const ASPECT_TOLERANCE = 0.01

export function outputDimensions(job: ExportJob): Size {
  return capShortSide(sourceOutputSize(job), job.maxShortSide)
}

function sourceOutputSize(job: ExportJob): Size {
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

function sliceDurationSec(slice: JobSlice): number {
  return Math.max(0, slice.sourceEnd - slice.sourceStart)
}

// Each slice is contain-fitted into the output, so its picture covers the
// fitted area, not the whole frame.
function sourceSlices(job: ExportJob, width: number, height: number): SourceSlice[] {
  return job.slices.map((slice) => {
    const source = job.sources[slice.sourceIndex]
    const frame = sliceFrameSize(job, slice)
    const fit =
      frame.width > 0 && frame.height > 0 ? Math.min(width / frame.width, height / frame.height) : 0
    return {
      durationSec: sliceDurationSec(slice),
      displayedPixels: frame.width * frame.height * fit * fit,
      sourceWidth: source?.width ?? 0,
      sourceHeight: source?.height ?? 0,
      videoBitrate: source?.videoBitrate,
      videoCodec: source?.videoCodec,
    }
  })
}

// "Original" passes source timing through, so on average frames arrive at the
// duration-weighted mean source rate.
function meanSourceFrameRate(job: ExportJob): number {
  let weighted = 0
  let measuredDuration = 0
  for (const slice of job.slices) {
    const rate = job.sources[slice.sourceIndex]?.frameRate ?? 0
    if (!(Number.isFinite(rate) && rate > 0)) continue
    weighted += rate * sliceDurationSec(slice)
    measuredDuration += sliceDurationSec(slice)
  }
  return measuredDuration > 0 ? weighted / measuredDuration : DEFAULT_FRAME_RATE
}

export function buildEditPlan(job: ExportJob): EditPlan {
  const requestedSize = outputDimensions(job)

  let cursorUs = 0
  const slices: EditSlice[] = job.slices.map((slice) => {
    const withStart: EditSlice = { ...slice, outStartTimestampUs: cursorUs }
    const durationUs = Math.round((slice.sourceEnd - slice.sourceStart) * 1_000_000)
    cursorUs += durationUs
    return withStart
  })

  const audibleSources: SourceAudio[] = job.slices
    .filter((slice) => !slice.muted && job.sources[slice.sourceIndex]?.hasAudio === true)
    .map((slice) => {
      const source = job.sources[slice.sourceIndex]
      return { bitrate: source?.audioBitrate, codec: source?.audioCodec }
    })
  const hasAudioOutput = job.slices.some(
    (slice) => job.sources[slice.sourceIndex]?.hasAudio === true
  )
  const durationSec = job.slices.reduce((sum, slice) => sum + sliceDurationSec(slice), 0)
  const paramsAt = (size: Size, fps: Framerate) => {
    const sourceEquivalent = sourceEquivalentBitrate(
      sourceSlices(job, size.width, size.height),
      job.videoCodec
    )
    const params = computeEncodeParams(size.width, size.height, fps, job.quality, {
      videoCodec: job.videoCodec,
      audioCodec: job.audioCodec,
      sourceEquivalent,
      sourceAudio: audibleSources,
    })
    return { sourceEquivalent, params }
  }

  let size = requestedSize
  let { sourceEquivalent, params } = paramsAt(size, job.fps)
  let nominalFrameRate = params.frameRate ?? meanSourceFrameRate(job)
  let targetFit: TargetSizeFit | null = null
  if (job.targetBytes) {
    targetFit = fitTargetSize({
      targetBytes: job.targetBytes,
      durationSec,
      size,
      frameRate: nominalFrameRate,
      videoCodec: job.videoCodec,
      audioCodec: job.audioCodec,
      sourceAudio: audibleSources,
      hasAudio: hasAudioOutput,
      sourceBitrateBound: sourceEquivalent?.raw ?? null,
      maxVideoBitrate: (candidate) => paramsAt(candidate, job.fps).params.videoBitrate,
    })
    size = targetFit.size
    ;({ sourceEquivalent, params } = paramsAt(size, job.fps))
    const frameRate = targetFit.frameRateLowered ? targetFit.frameRate : params.frameRate
    params = {
      ...params,
      frameRate,
      frameDurationUs: frameRate === null ? null : Math.round(1_000_000 / frameRate),
      videoBitrate: targetFit.videoBitrate,
      audioBitrate: targetFit.audioBitrate,
    }
    nominalFrameRate = frameRate ?? nominalFrameRate
  }

  return {
    outputWidth: size.width,
    outputHeight: size.height,
    slices,
    frameDurationUs: params.frameDurationUs,
    frameRate: params.frameRate,
    videoBitrate: params.videoBitrate,
    audioBitrate: params.audioBitrate,
    keyFrameIntervalUs: params.keyFrameIntervalUs,
    videoCodec: job.videoCodec,
    audioCodec: job.audioCodec,
    hasAudioOutput,
    nominalFrameRate,
    bitrateMode: bitrateModeFor(job.videoCodec, targetFit !== null),
    targetFit,
    sizeBasis: {
      durationSec,
      frameRate: nominalFrameRate,
      sourceEquivalent,
      sourceBitrateBound: sourceEquivalent?.raw ?? null,
      sourceBytes: coveredSourceBytes(
        job.slices.map((slice) => {
          const source = job.sources[slice.sourceIndex]
          return {
            durationSec: sliceDurationSec(slice),
            fileBytes: source?.file.size ?? 0,
            sourceDurationSec: source?.durationSec,
          }
        })
      ),
    },
  }
}
