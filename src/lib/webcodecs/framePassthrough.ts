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

// The VideoSample fields the frame check reads.
export type PassThroughFrame = Pick<
  VideoSample,
  'format' | 'rotation' | 'pixelAspectRatio' | 'visibleRect'
> & { colorSpace: Pick<VideoSample['colorSpace'], 'transfer'> }

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
