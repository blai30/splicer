import type { CropParams } from '@/lib/types'

export type SourceRect = { x: number; y: number; width: number; height: number }

// The part of the decoded frame to save: the segment's crop, scaled from the
// clip's probed display size to the size the video element decoded, or the
// whole frame. Rounded to whole pixels and kept inside the frame.
export function snapshotSourceRect(
  frame: { width: number; height: number },
  clip: { width: number; height: number },
  crop?: CropParams
): SourceRect {
  const whole = { x: 0, y: 0, width: frame.width, height: frame.height }
  if (!crop || crop.width <= 0 || crop.height <= 0 || clip.width <= 0 || clip.height <= 0) {
    return whole
  }
  const scaleX = frame.width / clip.width
  const scaleY = frame.height / clip.height
  const x = Math.min(frame.width - 1, Math.max(0, Math.round(crop.x * scaleX)))
  const y = Math.min(frame.height - 1, Math.max(0, Math.round(crop.y * scaleY)))
  const width = Math.max(1, Math.min(frame.width - x, Math.round(crop.width * scaleX)))
  const height = Math.max(1, Math.min(frame.height - y, Math.round(crop.height * scaleY)))
  return { x, y, width, height }
}

// "holiday-1m02.500s.png" for a frame 62.5 s into holiday.mp4: the clip's name
// without its extension, then the source time to the millisecond.
export function snapshotFilename(clipName: string, sourceTime: number): string {
  const base =
    clipName
      .replace(/\.[^./\\]+$/, '')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/^[\s-]+|[\s-]+$/g, '') || 'frame'
  const milliseconds = Math.round(Math.max(0, sourceTime) * 1000)
  const minutes = Math.floor(milliseconds / 60_000)
  const seconds = ((milliseconds % 60_000) / 1000).toFixed(3).padStart(6, '0')
  return `${base}-${minutes}m${seconds}s.png`
}
