import { clips, timeline } from '@/lib/store'
import type { Clip, Segment } from '@/lib/types'

export const ACCEPTED = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
]

export function isVideoFile(file: File): boolean {
  return ACCEPTED.includes(file.type) || /\.(mp4|webm|mov|avi|mkv)$/i.test(file.name)
}

export function getVideoMetadata(
  url: string
): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () =>
      resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight })
    v.src = url
  })
}

export function captureThumbnail(url: string): Promise<string> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.src = url
    v.currentTime = 0.5
    v.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 160
      canvas.height = 90
      canvas.getContext('2d')!.drawImage(v, 0, 0, 160, 90)
      resolve(canvas.toDataURL('image/jpeg', 0.6))
    }
  })
}

export async function importAndAppend(file: File): Promise<void> {
  if (!isVideoFile(file)) return
  const objectUrl = URL.createObjectURL(file)
  const { duration, width, height } = await getVideoMetadata(objectUrl)
  const thumbnail = await captureThumbnail(objectUrl)
  const clip: Clip = {
    id: crypto.randomUUID(),
    file,
    name: file.name.replace(/\.[^.]+$/, ''),
    duration,
    width,
    height,
    objectUrl,
    thumbnail,
  }
  clips.value = [...clips.value, clip]
  const seg: Segment = {
    id: crypto.randomUUID(),
    clipId: clip.id,
    startTime: 0,
    endTime: duration,
    muted: false,
  }
  timeline.value = [...timeline.value, seg]
}
