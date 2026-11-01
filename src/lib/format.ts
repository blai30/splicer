import type { Framerate } from '@/lib/types'

export function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const sec = Math.floor(seconds % 60)
  return `${minutes}:${sec.toString().padStart(2, '0')}`
}

export function formatTimecode(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const sec = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 10)
  return `${minutes}:${sec.toString().padStart(2, '0')}.${ms}`
}

// "0:12.40": hundredths, for gesture readouts that need to show frame-level moves.
export function formatPreciseTime(seconds: number): string {
  const hundredths = Math.round(Math.max(0, seconds) * 100)
  const minutes = Math.floor(hundredths / 6000)
  const sec = Math.floor((hundredths % 6000) / 100)
  const fraction = hundredths % 100
  return `${minutes}:${sec.toString().padStart(2, '0')}.${fraction.toString().padStart(2, '0')}`
}

// "+1.20s" / "−0.50s" (a true minus sign, so the column does not jitter).
export function formatSignedSeconds(seconds: number): string {
  const rounded = Math.round(seconds * 100) / 100
  const sign = rounded < 0 ? '\u2212' : '+'
  return `${sign}${Math.abs(rounded).toFixed(2)}s`
}

export function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000_000) return `${(bytes / 1_000_000_000_000).toFixed(1)} TB`
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`
  return `${bytes} B`
}

// "1.7–2.3 MB", or "900 KB–1.1 MB" when the ends use different units.
export function formatSizeRange(low: number, high: number): string {
  const lowText = formatSize(Math.round(low))
  const highText = formatSize(Math.round(high))
  const [lowValue, lowUnit] = lowText.split(' ')
  const [highValue, highUnit] = highText.split(' ')
  return lowUnit === highUnit ? `${lowValue}–${highValue} ${highUnit}` : `${lowText}–${highText}`
}

export function formatFps(fps: Framerate): string {
  return fps === 'original' ? 'Original' : `${fps} fps`
}
