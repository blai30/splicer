import { fetchFile } from '@ffmpeg/util'

import { getFFmpeg } from '@/lib/ffmpeg'
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
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.preload = 'metadata'

    const cleanup = () => {
      v.onloadedmetadata = null
      v.onerror = null
      v.src = ''
      v.load()
    }

    v.onloadedmetadata = () => {
      const metadata = { duration: v.duration, width: v.videoWidth, height: v.videoHeight }
      cleanup()
      resolve(metadata)
    }
    v.onerror = () => {
      cleanup()
      reject(new Error('Failed to read video metadata'))
    }

    v.src = url
  })
}

function getPeaksFromSamples(samples: Float32Array, peakCount: number): number[] {
  if (samples.length === 0) return []
  const target = Math.max(64, Math.floor(peakCount))
  const samplesPerPeak = Math.max(1, Math.floor(samples.length / target))
  const peaks: number[] = []

  for (let i = 0; i < samples.length; i += samplesPerPeak) {
    const end = Math.min(samples.length, i + samplesPerPeak)
    let peak = 0
    for (let s = i; s < end; s++) {
      const amp = Math.abs(samples[s])
      if (amp > peak) peak = amp
    }
    peaks.push(peak)
  }

  return peaks
}

async function extractWaveformPeaksWithAudioContext(
  file: File,
  peakCount = 2000
): Promise<number[]> {
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

    const merged = new Float32Array(totalSamples)
    for (let c = 0; c < channels; c++) {
      const data = decoded.getChannelData(c)
      for (let i = 0; i < totalSamples; i++) {
        const amp = Math.abs(data[i])
        if (amp > merged[i]) merged[i] = amp
      }
    }

    return getPeaksFromSamples(merged, peakCount)
  } catch {
    return []
  } finally {
    void ctx.close()
  }
}

async function extractWaveformPeaksWithFfmpeg(file: File, peakCount = 2000): Promise<number[]> {
  const ext = file.name.split('.').pop() ?? 'mp4'
  const runId = crypto.randomUUID().replace(/-/g, '')
  const inputName = `waveform_${runId}.${ext}`
  const outputName = `waveform_${runId}.f32`

  let ffmpeg
  try {
    ffmpeg = await getFFmpeg()
    await ffmpeg.writeFile(inputName, await fetchFile(file))
    const ret = await ffmpeg.exec([
      '-i',
      inputName,
      '-vn',
      '-map',
      'a:0?',
      '-ac',
      '1',
      '-ar',
      '8000',
      '-f',
      'f32le',
      outputName,
    ])
    if (ret !== 0) return []

    const pcm = (await ffmpeg.readFile(outputName)) as Uint8Array
    const aligned = Math.floor(pcm.byteLength / 4) * 4
    if (aligned === 0) return []

    const view = new Float32Array(pcm.buffer, pcm.byteOffset, aligned / 4)
    return getPeaksFromSamples(view, peakCount)
  } catch {
    return []
  } finally {
    if (ffmpeg) {
      try {
        await ffmpeg.deleteFile(inputName)
      } catch {
        // Best effort cleanup for temp input file.
      }
      try {
        await ffmpeg.deleteFile(outputName)
      } catch {
        // Best effort cleanup for temp output file.
      }
    }
  }
}

export async function extractWaveformPeaks(file: File, peakCount = 2000): Promise<number[]> {
  const byAudioContext = await extractWaveformPeaksWithAudioContext(file, peakCount)
  if (byAudioContext.length > 0) return byAudioContext
  return extractWaveformPeaksWithFfmpeg(file, peakCount)
}

const waveformPending = new Set<string>()

export async function ensureClipWaveform(clipId: string): Promise<void> {
  const clip = clips.value.find((c) => c.id === clipId)
  if (!clip || (clip.waveformPeaks?.length ?? 0) > 0) return
  if (waveformPending.has(clipId)) return

  waveformPending.add(clipId)
  try {
    const peaks = await extractWaveformPeaks(clip.file)
    if (peaks.length === 0) return
    clips.value = clips.value.map((c) =>
      c.id === clipId
        ? {
            ...c,
            waveformPeaks: peaks,
          }
        : c
    )
  } finally {
    waveformPending.delete(clipId)
  }
}

export async function importAndAppend(file: File): Promise<void> {
  if (!isVideoFile(file)) return

  const objectUrl = URL.createObjectURL(file)
  let imported = false

  try {
    const { duration, width, height } = await getVideoMetadata(objectUrl)
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Invalid video duration')
    }

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
    imported = true
  } catch {
    // Ignore individual import failures so batch imports continue.
  } finally {
    if (!imported) URL.revokeObjectURL(objectUrl)
  }
}
