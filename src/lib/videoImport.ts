import { info, warn, error as logError } from '@/lib/logger'
import { clips, getClipById, importing } from '@/lib/store'
import { appendClipToTimeline } from '@/lib/timelineEditing'
import type { Clip } from '@/lib/types'

export const ACCEPTED = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm']

export function isVideoFile(file: File): boolean {
  return ACCEPTED.includes(file.type) || /\.(mp4|mkv|mov|webm)$/i.test(file.name)
}

export function getVideoMetadata(
  url: string
): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'

    const cleanup = () => {
      video.onloadedmetadata = null
      video.ondurationchange = null
      video.onerror = null
      video.src = ''
      video.load()
    }

    const finish = () => {
      const metadata = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      }
      cleanup()
      resolve(metadata)
    }

    video.onloadedmetadata = () => {
      // MediaRecorder output (e.g. screen recordings) can report Infinity;
      // seeking far past the end forces the browser to compute the real
      // duration and fire durationchange.
      if (!Number.isFinite(video.duration)) {
        video.ondurationchange = () => {
          if (Number.isFinite(video.duration)) finish()
        }
        video.currentTime = Number.MAX_SAFE_INTEGER
        return
      }
      finish()
    }
    video.onerror = () => {
      cleanup()
      reject(new Error('Failed to read video metadata'))
    }

    video.src = url
  })
}

export function getPeaksFromSamples(samples: Float32Array, peakCount: number): number[] {
  if (samples.length === 0) return []
  const target = Math.max(64, Math.floor(peakCount))
  const samplesPerPeak = Math.max(1, Math.floor(samples.length / target))
  const peaks: number[] = []

  for (let i = 0; i < samples.length; i += samplesPerPeak) {
    const end = Math.min(samples.length, i + samplesPerPeak)
    let peak = 0
    for (let sampleIndex = i; sampleIndex < end; sampleIndex++) {
      const amp = Math.abs(samples[sampleIndex])
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
    for (let channel = 0; channel < channels; channel++) {
      const data = decoded.getChannelData(channel)
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

export async function extractWaveformPeaks(file: File, peakCount = 2000): Promise<number[]> {
  // WebAudio decodeAudioData is the only extraction path now that FFmpeg is
  // removed. Files the browser cannot decode yield no peaks and are treated as
  // having no audio.
  return extractWaveformPeaksWithAudioContext(file, peakCount)
}

const waveformPending = new Set<string>()

export async function ensureClipWaveform(clipId: string): Promise<void> {
  const clip = getClipById(clipId)
  if (!clip || (clip.waveformPeaks?.length ?? 0) > 0) return
  // hasAudio set with empty peaks means a completed probe found no audio
  // stream; do not re-decode the file on every segment mount.
  if (clip.hasAudio !== undefined) return
  if (waveformPending.has(clipId)) return

  waveformPending.add(clipId)
  try {
    const peaks = await extractWaveformPeaks(clip.file)
    // No extractable peaks from either decoder means the file has no audio
    // stream; the export planner uses this to substitute silent audio.
    clips.value = clips.value.map((clip) =>
      clip.id === clipId
        ? {
            ...clip,
            waveformPeaks: peaks,
            hasAudio: peaks.length > 0,
          }
        : clip
    )
  } finally {
    waveformPending.delete(clipId)
  }
}

export async function importAndAppend(file: File): Promise<void> {
  if (!isVideoFile(file)) {
    warn('Skipped non-video file', { name: file.name, type: file.type })
    return
  }

  const objectUrl = URL.createObjectURL(file)
  let imported = false

  try {
    info('Importing file', { name: file.name })
    importing.value = true
    const { duration, width, height } = await getVideoMetadata(objectUrl)
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Invalid video duration')
    }

    // Defer waveform extraction to avoid blocking import. Waveform will be
    // generated lazily when the segment's view mounts (see SegmentBlock).
    const clip: Clip = {
      id: crypto.randomUUID(),
      file,
      name: file.name.replace(/\.[^.]+$/, ''),
      duration,
      width,
      height,
      objectUrl,
      waveformPeaks: [],
    }
    appendClipToTimeline(clip)
    imported = true
    info('Import succeeded', { name: file.name, duration })
  } catch (err) {
    // Log but keep going so batch imports continue with the remaining files.
    const rawMessage = err instanceof Error ? err.message : String(err)
    const friendly = /metadata/i.test(rawMessage)
      ? `Could not read "${file.name}". The codec (e.g. AV1) may not be supported by this browser.`
      : rawMessage
    logError('Import failed', { name: file.name, message: friendly })
  } finally {
    if (!imported) URL.revokeObjectURL(objectUrl)
    importing.value = false
  }
}
