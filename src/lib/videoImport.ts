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

export async function extractWaveformPeaks(file: File, peakCount = 2000): Promise<number[]> {
  if (typeof window === 'undefined') return []

  const AudioCtx =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) return []

  const ctx = new AudioCtx()
  try {
    const buffer = await file.arrayBuffer()
    const decoded = await ctx.decodeAudioData(buffer)
    const channels = decoded.numberOfChannels
    const totalSamples = decoded.length
    if (!channels || !totalSamples) return []

    const target = Math.max(64, Math.floor(peakCount))
    const samplesPerPeak = Math.max(1, Math.floor(totalSamples / target))
    const peaks: number[] = []

    for (let i = 0; i < totalSamples; i += samplesPerPeak) {
      const end = Math.min(totalSamples, i + samplesPerPeak)
      let peak = 0
      for (let c = 0; c < channels; c++) {
        const data = decoded.getChannelData(c)
        for (let s = i; s < end; s++) {
          const amp = Math.abs(data[s])
          if (amp > peak) peak = amp
        }
      }
      peaks.push(peak)
    }

    return peaks
  } catch {
    return []
  } finally {
    void ctx.close()
  }
}

export async function importAndAppend(file: File): Promise<void> {
  if (!isVideoFile(file)) return
  const objectUrl = URL.createObjectURL(file)
  const { duration, width, height } = await getVideoMetadata(objectUrl)
  const waveformPeaks = await extractWaveformPeaks(file)
  const clip: Clip = {
    id: crypto.randomUUID(),
    file,
    name: file.name.replace(/\.[^.]+$/, ''),
    duration,
    width,
    height,
    objectUrl,
    waveformPeaks,
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
