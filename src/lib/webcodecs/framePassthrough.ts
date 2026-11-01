import type { VideoSample } from 'mediabunny'

import type { CropParams } from '../types'
import type { JobSource } from './protocol'

type OutputSize = { outputWidth: number; outputHeight: number }

// A crop that keeps the whole frame changes nothing.
function isFullFrameCrop(crop: CropParams | undefined, source: JobSource): boolean {
  if (!crop) return true
  return (
    crop.x === 0 && crop.y === 0 && crop.width === source.width && crop.height === source.height
  )
}

// Whether a slice's decoded frames already look exactly like the output frame:
// uncropped, unrotated, and the same size. Such frames can go to the encoder
// as decoded, skipping the canvas draw and its RGBA readback and conversion.
export function canPassThrough(
  slice: { crop?: CropParams },
  source: JobSource | undefined,
  plan: OutputSize
): boolean {
  if (!source) return false
  return (
    isFullFrameCrop(slice.crop, source) &&
    (source.rotation ?? 0) === 0 &&
    source.width === plan.outputWidth &&
    source.height === plan.outputHeight
  )
}

// 8-bit layouts every encoder accepts as-is. 10-bit and alpha formats, and
// frames the decoder could not describe (null), take the canvas path.
const PASSTHROUGH_FORMATS = new Set(['I420', 'NV12', 'RGBX', 'BGRX'])
// HDR transfer functions an 8-bit encode would wash out.
const HDR_TRANSFERS = new Set(['pq', 'hlg'])

type FrameColor = Pick<VideoSample['colorSpace'], 'primaries' | 'transfer' | 'matrix' | 'fullRange'>

// The VideoSample fields the frame checks read.
export type PassThroughFrame = Pick<
  VideoSample,
  'format' | 'rotation' | 'pixelAspectRatio' | 'visibleRect'
> & { colorSpace: FrameColor }

// The per-frame half of the guard. Container metadata can disagree with the
// decoded frames (a rotated or anamorphic stream, an HDR or 10-bit decode), so
// every frame is checked before it skips the canvas.
export function isPassThroughFrame(sample: PassThroughFrame, plan: OutputSize): boolean {
  if (!sample.format || !PASSTHROUGH_FORMATS.has(sample.format)) return false
  if (sample.rotation !== 0) return false
  if (sample.pixelAspectRatio.num !== sample.pixelAspectRatio.den) return false
  const transfer = sample.colorSpace.transfer
  if (transfer && HDR_TRANSFERS.has(transfer)) return false
  const rect = sample.visibleRect
  return (
    rect.left === 0 &&
    rect.top === 0 &&
    rect.width === plan.outputWidth &&
    rect.height === plan.outputHeight
  )
}

// Whether a whole export can skip the canvas. The encoder tags the stream with
// the color space of its first frame, and decoded frames (usually limited
// range) differ from canvas snapshots (full range RGB), so mixing the two
// paths in one export would show a color jump at the cut. Passthrough is all
// or nothing.
export function canPassThroughExport(
  slices: readonly { crop?: CropParams; sourceIndex: number }[],
  sources: readonly (JobSource | undefined)[],
  plan: OutputSize
): boolean {
  return (
    slices.length > 0 &&
    slices.every((slice) => canPassThrough(slice, sources[slice.sourceIndex], plan))
  )
}

// A frame in a passthrough export that cannot be sent as decoded, or whose
// color space differs from the frames before it. The export is redone with
// every frame drawn.
export class PassThroughMismatchError extends Error {
  constructor() {
    super('A frame cannot pass through to the encoder')
    this.name = 'PassThroughMismatchError'
  }
}

function sameColor(first: FrameColor, other: FrameColor): boolean {
  return (
    first.primaries === other.primaries &&
    first.transfer === other.transfer &&
    first.matrix === other.matrix &&
    first.fullRange === other.fullRange
  )
}

export type PassThroughGate = { admit: (sample: PassThroughFrame) => void }

// Checks every frame of a passthrough export, across all its slices. Throws
// PassThroughMismatchError instead of drawing the odd frame, which would
// switch paths midway.
export function createPassThroughGate(plan: OutputSize): PassThroughGate {
  let firstColor: FrameColor | null = null
  return {
    admit(sample) {
      if (!isPassThroughFrame(sample, plan)) throw new PassThroughMismatchError()
      const { primaries, transfer, matrix, fullRange } = sample.colorSpace
      firstColor ??= { primaries, transfer, matrix, fullRange }
      if (!sameColor(firstColor, sample.colorSpace)) throw new PassThroughMismatchError()
    },
  }
}

// Run an export with passthrough, and if a frame turns out not to qualify, run
// it again with every frame drawn.
export async function withPassThroughFallback<T>(
  passThrough: boolean,
  attempt: (passThrough: boolean) => Promise<T>,
  canceled: () => boolean
): Promise<T> {
  try {
    return await attempt(passThrough)
  } catch (error) {
    if (!passThrough || canceled() || !(error instanceof PassThroughMismatchError)) throw error
    return attempt(false)
  }
}
