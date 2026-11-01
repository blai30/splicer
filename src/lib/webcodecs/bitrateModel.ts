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
// content (testsrc2, mandelbrot, 360p to 720p): below about this many bits per
// frame, a fixed part plus a part per pixel, they stop following the target.
// Used only to predict the size and explain it, never to raise the requested
// bitrate: hardware encoders differ, and simpler content goes lower.
const ENCODER_FLOOR: Record<string, { baseBitsPerFrame: number; bitsPerPixel: number }> = {
  avc: { baseBitsPerFrame: 4_800, bitsPerPixel: 0.027 },
  vp9: { baseBitsPerFrame: 4_000, bitsPerPixel: 0.016 },
  vp8: { baseBitsPerFrame: 4_800, bitsPerPixel: 0.028 },
}
// OpenH264 tops out near this at its best quantizer, whatever the target.
const ENCODER_CEILING_BPP: Record<string, number> = { avc: 0.4 }
// libvpx VBR overshoots a little near its floor and lands well under a
// generous target, so its delivered share falls as bits per pixel rise.
const VP9_ADHERENCE = { lowBpp: 0.02, atLow: 1.05, highBpp: 0.05, atHigh: 0.85 }
// The source's bitrate bounds how complex the picture can be: simple content
// lands under the complex-content floor (measured from 0.7x to 2x the source
// at the coarsest quantizer), and a best-quantizer encode of it stays within
// a few times the source.
const FLOOR_SOURCE_MULTIPLE = { low: 0.7, expected: 1.5, high: 3 }
const CEILING_SOURCE_MULTIPLE = 4
const MUX_OVERHEAD = 1.01

const AUDIO_PRESETS: Record<MbAudioCodec, Record<Quality, number>> = {
  aac: { lossless: 128_000, high: 128_000, medium: 96_000, low: 64_000 },
  opus: { lossless: 128_000, high: 96_000, medium: 64_000, low: 48_000 },
}
// AAC encoders are only reliable on the usual rates, and some platform
// encoders reject anything under 32k, so a quieter source still gets 32k.
// Opus takes any rate.
const AAC_LADDER = [32_000, 48_000, 64_000, 96_000, 128_000, 160_000, 192_000]
const OPUS_STEP = 8_000
const OPUS_MIN = 16_000
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
// Below Maximum the cap is also the source's own bitrate, as for video, so a
// conversion to a less efficient codec does not grow the file past the source
// (AAC's 32k minimum aside).
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
    const bitrate = source.bitrate ?? 0
    const converted = (bitrate * outputEfficiency) / sourceEfficiency
    cap = Math.max(cap, quality === 'lossless' ? converted : Math.min(converted, bitrate))
  }
  return snapAudioBitrate(Math.min(preset, cap), codec)
}

export type SizeBasis = {
  durationSec: number
  // Output frame rate used for the encoder floor ("original" resolved).
  frameRate: number
  sourceEquivalent: SourceEquivalent | null
  // Raw source bits per second the output picture carries, scaled by displayed
  // area and summed over layers shown together. Bounds how complex the
  // picture can be, even when overlapping layers leave no source-equivalent.
  sourceBitrateBound: number | null
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

// Share of a VP9 target libvpx delivers at this many bits per pixel.
function vp9Adherence(bitsPerPixel: number): number {
  const { lowBpp, atLow, highBpp, atHigh } = VP9_ADHERENCE
  const progress = Math.min(1, Math.max(0, (bitsPerPixel - lowBpp) / (highBpp - lowBpp)))
  return atLow + (atHigh - atLow) * progress
}

export function estimateOutputBytes(input: EstimateInput): SizeEstimate {
  const frameRate = Math.max(1, input.frameRate)
  const pixels = input.width * input.height
  const pixelRate = pixels * frameRate
  const floorModel = ENCODER_FLOOR[input.videoCodec] ?? ENCODER_FLOOR.avc
  const complexFloor = (floorModel.baseBitsPerFrame + floorModel.bitsPerPixel * pixels) * frameRate
  const bound = input.sourceBitrateBound
  const floorAt = (multiple: number) =>
    bound !== null ? Math.min(complexFloor, bound * multiple) : complexFloor
  const floor = floorAt(FLOOR_SOURCE_MULTIPLE.expected)
  const ceilingBpp = ENCODER_CEILING_BPP[input.videoCodec]
  let ceiling = ceilingBpp === undefined ? Infinity : ceilingBpp * pixelRate
  if (bound !== null)
    ceiling = Math.min(ceiling, Math.max(complexFloor, bound * CEILING_SOURCE_MULTIPLE))
  const adherence =
    input.videoCodec === 'vp9' ? vp9Adherence(input.videoBitrate / Math.max(1, pixelRate)) : 1
  const delivered = input.videoBitrate * adherence
  const belowEncoderFloor = delivered < floor * 0.95

  // Encoders follow a target closely on complex content (libvpx a bit less);
  // the floor itself varies with content, and content dependence dominates
  // without source stats.
  const spread = !input.sourceEquivalent
    ? 0.4
    : belowEncoderFloor
      ? 0.25
      : input.videoCodec === 'vp9'
        ? 0.2
        : 0.15
  const videoExpected = Math.min(Math.max(delivered, floor), ceiling)
  // A request near the floor may land anywhere the source allows: down to its
  // simplest-content share, or up to its most compressed-complex one.
  const videoLow = Math.min(
    videoExpected * (1 - spread),
    Math.max(delivered, floorAt(FLOOR_SOURCE_MULTIPLE.low))
  )
  const videoHigh = Math.max(
    videoExpected * (1 + spread),
    Math.min(floorAt(FLOOR_SOURCE_MULTIPLE.high), ceiling)
  )

  const duration = Math.max(0, input.durationSec)
  const toBytes = (videoBitrate: number) =>
    (((videoBitrate + input.audioBitrate) * duration) / 8) * MUX_OVERHEAD
  return {
    low: toBytes(videoLow),
    expected: toBytes(videoExpected),
    high: toBytes(videoHigh),
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
