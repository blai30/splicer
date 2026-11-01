import type { MbAudioCodec, MbVideoCodec } from '../exportCodecs'
import type { Quality } from '../types'

// Bits each codec needs for similar quality, relative to H.264. Used both to
// convert a source's bitrate into the output codec and to scale the fallback
// table, so VP9 is not handed the bitrate H.264 would need.
export const CODEC_EFFICIENCY: Record<string, number> = {
  avc: 1,
  hevc: 0.6,
  vp9: 0.65,
  av1: 0.45,
  vp8: 1.15,
}

const AUDIO_CODEC_EFFICIENCY: Record<string, number> = {
  aac: 1,
  opus: 0.7,
  mp3: 1.25,
  vorbis: 0.85,
}

// Each preset as a fraction of the source-equivalent bitrate. High matches the
// source so it does not grow the file; Maximum is the opt-in tier above it.
export const PRESET_FRACTION: Record<Quality, number> = {
  lossless: 1.5,
  high: 1.0,
  medium: 0.6,
  low: 0.35,
}

// 1080p H.264 bitrates (bits/sec), scaled linearly by pixel count. They cap
// source-relative targets and stand in when the source bitrate is unknown.
export const VIDEO_BITRATE_1080P: Record<Quality, number> = {
  lossless: 40_000_000,
  high: 12_000_000,
  medium: 6_000_000,
  low: 2_500_000,
}

const REF_PIXELS = 1920 * 1080
const MIN_TABLE_VIDEO_BITRATE = 100_000
// Source-relative targets may go far lower: a tiny screen recording has a tiny
// bitrate and its export should too.
const MIN_SOURCE_VIDEO_BITRATE = 16_000

// Measured with Chromium's software encoders (OpenH264, libvpx) on complex
// content: below about this many bits per pixel per frame, or this many bits
// per frame at small sizes, they stop following the target. Used only to
// predict the size and explain it, never to raise the requested bitrate:
// hardware encoders differ, and simpler content goes lower.
const ENCODER_FLOOR: Record<string, { bitsPerPixel: number; minBitsPerFrame: number }> = {
  avc: { bitsPerPixel: 0.025, minBitsPerFrame: 4_400 },
  vp9: { bitsPerPixel: 0.016, minBitsPerFrame: 3_400 },
  vp8: { bitsPerPixel: 0.028, minBitsPerFrame: 4_400 },
}
// OpenH264 tops out near this at its best quantizer, whatever the target.
const ENCODER_CEILING_BPP: Record<string, number> = { avc: 0.4 }
// libvpx VBR lands under its target on typical content.
const BITRATE_ADHERENCE: Record<string, number> = { vp9: 0.85 }
// Simple content lands under the complex-content floor even at the coarsest
// quantizer. The source's own bitrate bounds how complex it can be.
const FLOOR_SOURCE_MULTIPLE = 3
const MUX_OVERHEAD = 1.01

const AUDIO_PRESETS: Record<MbAudioCodec, Record<Quality, number>> = {
  aac: { lossless: 128_000, high: 128_000, medium: 96_000, low: 64_000 },
  opus: { lossless: 128_000, high: 96_000, medium: 64_000, low: 48_000 },
}
// AAC encoders are only reliable on the usual rates; Opus takes any rate.
const AAC_LADDER = [32_000, 48_000, 64_000, 96_000, 128_000, 160_000, 192_000]
const OPUS_STEP = 8_000
const OPUS_MIN = 24_000
// A source a few percent under a ladder step still rounds to that step.
const LADDER_TOLERANCE = 1.05

export function codecEfficiency(codec: string | undefined): number {
  return CODEC_EFFICIENCY[codec ?? ''] ?? 1
}

// One stretch of output picture fed by one source.
export type SourceSlice = {
  durationSec: number
  // Output pixels this slice's picture covers (after fit or placement).
  displayedPixels: number
  sourceWidth: number
  sourceHeight: number
  videoBitrate?: number
  videoCodec?: string
}

export type SourceEquivalent = {
  // What the source spends on this picture, re-expressed in the output codec.
  codecAdjusted: number
  // The same without the codec conversion, so a cap in these terms keeps the
  // export from outgrowing the source even when converting to a weaker codec.
  raw: number
}

// Duration-weighted mean of each slice's bitrate scaled by displayed pixels
// over source pixels. Displayed pixels already account for crops (a crop shown
// at its own size needs only its share of the bits) and letterboxing. Null
// when any slice lacks a measured bitrate: a partial mean would mislead.
export function sourceEquivalentBitrate(
  slices: SourceSlice[],
  outputCodec: MbVideoCodec
): SourceEquivalent | null {
  let totalDuration = 0
  let rawSum = 0
  let adjustedSum = 0
  for (const slice of slices) {
    const sourcePixels = slice.sourceWidth * slice.sourceHeight
    if (!(slice.durationSec > 0)) continue
    if (!(slice.videoBitrate && slice.videoBitrate > 0) || !(sourcePixels > 0)) return null
    const raw = slice.videoBitrate * (slice.displayedPixels / sourcePixels)
    const adjusted =
      (raw * codecEfficiency(outputCodec)) / codecEfficiency(slice.videoCodec ?? 'avc')
    totalDuration += slice.durationSec
    rawSum += raw * slice.durationSec
    adjustedSum += adjusted * slice.durationSec
  }
  if (totalDuration <= 0) return null
  return { codecAdjusted: adjustedSum / totalDuration, raw: rawSum / totalDuration }
}

export function tableVideoBitrate(
  width: number,
  height: number,
  quality: Quality,
  codec: MbVideoCodec
): number {
  const pixelRatio = (width * height) / REF_PIXELS
  return Math.max(
    MIN_TABLE_VIDEO_BITRATE,
    Math.round(VIDEO_BITRATE_1080P[quality] * pixelRatio * codecEfficiency(codec))
  )
}

// The bitrate to request. With a known source: the preset's fraction of the
// source-equivalent, never above the table, and for every preset but Maximum
// never above what the source itself spends on the picture. Upscaling raises
// displayed pixels, so it raises that cap too.
export function targetVideoBitrate(
  width: number,
  height: number,
  quality: Quality,
  codec: MbVideoCodec,
  sourceEquivalent: SourceEquivalent | null
): number {
  const table = tableVideoBitrate(width, height, quality, codec)
  if (!sourceEquivalent) return table
  let target = Math.min(table, PRESET_FRACTION[quality] * sourceEquivalent.codecAdjusted)
  if (quality !== 'lossless') target = Math.min(target, sourceEquivalent.raw)
  return Math.max(MIN_SOURCE_VIDEO_BITRATE, Math.round(target))
}

export type SourceAudio = { bitrate?: number; codec?: string }

function snapAudioBitrate(bitrate: number, codec: MbAudioCodec): number {
  if (codec === 'opus') {
    return Math.max(OPUS_MIN, Math.floor(bitrate / OPUS_STEP) * OPUS_STEP)
  }
  let snapped = AAC_LADDER[0]
  for (const step of AAC_LADDER) if (step <= bitrate * LADDER_TOLERANCE) snapped = step
  return snapped
}

// The preset rate for the codec, capped at the richest audible source (in the
// output codec's terms) when every audible source has a measured bitrate.
export function targetAudioBitrate(
  quality: Quality,
  codec: MbAudioCodec,
  sources: SourceAudio[]
): number {
  const preset = AUDIO_PRESETS[codec][quality]
  if (sources.length === 0 || sources.some((source) => !(source.bitrate && source.bitrate > 0))) {
    return preset
  }
  const outputEfficiency = AUDIO_CODEC_EFFICIENCY[codec] ?? 1
  let cap = 0
  for (const source of sources) {
    const sourceEfficiency = AUDIO_CODEC_EFFICIENCY[source.codec ?? ''] ?? 1
    cap = Math.max(cap, ((source.bitrate ?? 0) * outputEfficiency) / sourceEfficiency)
  }
  return snapAudioBitrate(Math.min(preset, cap), codec)
}

export type SizeBasis = {
  durationSec: number
  // Output frame rate used for the encoder floor ("original" resolved).
  frameRate: number
  sourceEquivalent: SourceEquivalent | null
  // Bytes of the source footage the export covers, for comparison.
  sourceBytes: number | null
}

export type EstimateInput = SizeBasis & {
  width: number
  height: number
  videoCodec: MbVideoCodec
  videoBitrate: number
  // Zero when the output has no audio.
  audioBitrate: number
}

export type SizeEstimate = {
  low: number
  expected: number
  high: number
  sourceBytes: number | null
  // The request is under what the encoder can reach at this size, so the file
  // lands at the floor instead (bigger than the preset suggests).
  belowEncoderFloor: boolean
  // Lowest video bitrate the encoder is predicted to reach here.
  encoderFloorBitrate: number
}

export function estimateOutputBytes(input: EstimateInput): SizeEstimate {
  const frameRate = Math.max(1, input.frameRate)
  const pixelRate = input.width * input.height * frameRate
  const floorModel = ENCODER_FLOOR[input.videoCodec] ?? ENCODER_FLOOR.avc
  const complexFloor =
    Math.max(floorModel.bitsPerPixel * input.width * input.height, floorModel.minBitsPerFrame) *
    frameRate
  const floor = input.sourceEquivalent
    ? Math.min(complexFloor, input.sourceEquivalent.raw * FLOOR_SOURCE_MULTIPLE)
    : complexFloor
  const ceilingBpp = ENCODER_CEILING_BPP[input.videoCodec]
  const ceiling = ceilingBpp === undefined ? Infinity : ceilingBpp * pixelRate
  const delivered = input.videoBitrate * (BITRATE_ADHERENCE[input.videoCodec] ?? 1)
  const videoBitrate = Math.min(Math.max(delivered, floor), ceiling)
  const belowEncoderFloor = delivered < floor * 0.95

  const duration = Math.max(0, input.durationSec)
  const expected = (((videoBitrate + input.audioBitrate) * duration) / 8) * MUX_OVERHEAD
  // Encoders follow a target closely on complex content; content dependence
  // dominates at the floor and without source stats.
  const spread = !input.sourceEquivalent ? 0.4 : belowEncoderFloor ? 0.3 : 0.15
  return {
    low: expected * (1 - spread),
    expected,
    high: expected * (1 + spread),
    sourceBytes: input.sourceBytes,
    belowEncoderFloor,
    encoderFloorBitrate: floor,
  }
}

// Plans carry their size basis, so callers can estimate without redoing the
// layout math.
export type EstimablePlan = {
  outputWidth: number
  outputHeight: number
  videoCodec: MbVideoCodec
  videoBitrate: number
  audioBitrate: number
  hasAudioOutput: boolean
  sizeBasis: SizeBasis
}

export function estimatePlanBytes(plan: EstimablePlan): SizeEstimate {
  return estimateOutputBytes({
    ...plan.sizeBasis,
    width: plan.outputWidth,
    height: plan.outputHeight,
    videoCodec: plan.videoCodec,
    videoBitrate: plan.videoBitrate,
    audioBitrate: plan.hasAudioOutput ? plan.audioBitrate : 0,
  })
}

export type SourceSpan = { durationSec: number; fileBytes: number; sourceDurationSec?: number }

// The share of each source file the export covers. Null when any source
// duration is unknown.
export function coveredSourceBytes(spans: SourceSpan[]): number | null {
  let total = 0
  for (const span of spans) {
    if (!(span.sourceDurationSec && span.sourceDurationSec > 0)) return null
    total += span.fileBytes * Math.min(1, Math.max(0, span.durationSec) / span.sourceDurationSec)
  }
  return spans.length > 0 ? total : null
}
