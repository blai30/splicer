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

export function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000_000) return `${(bytes / 1_000_000_000_000).toFixed(1)} TB`
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`
  return `${bytes} B`
}

export function formatFps(fps: Framerate): string {
  return fps === 'original' ? 'Original' : `${fps} fps`
}
