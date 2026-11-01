import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  Input,
  IsobmffInputFormat,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny'

import { appendClipToTrack } from '@/lib/advanced/advancedSegmentEditing'
import { info, warn, error as logError } from '@/lib/logger'
import { clips, getClipById, importErrors, importing } from '@/lib/store'
import { appendClipToTimeline } from '@/lib/timelineEditing'
import type { Clip } from '@/lib/types'

export const ACCEPTED = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm']
const ACCEPTED_EXTENSIONS = /\.(mp4|m4v|mkv|mov|webm)$/i
export const FILE_INPUT_ACCEPT = 'video/*,.mp4,.m4v,.mkv,.mov,.webm'

const METADATA_TIMEOUT_MS = 15_000
const DEFAULT_FRAME_RATE = 30
// Packets sampled when the container has no up-front index (MKV/WebM). Enough
// to get past a high-bitrate opening GOP without scanning a long file.
const SAMPLED_PACKET_COUNT = 600

class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

export function isVideoFile(file: File): boolean {
  return ACCEPTED.includes(file.type) || ACCEPTED_EXTENSIONS.test(file.name)
}

export type StreamStats = {
  frameRate?: number
  videoBitrate?: number
  videoCodec?: string
  audioBitrate?: number
  audioCodec?: string
}

export type MediaProbe = StreamStats & {
  duration: number
  width: number
  height: number
  frameRate: number
  hasAudio: boolean
}

function positive(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined
}

// MP4/MOV keep a full sample table in metadata, so stats over every packet are
// cheap and immune to an unrepresentative opening. Other containers would have
// to scan the whole file, so they are sampled.
export async function hasPacketIndex(input: Input): Promise<boolean> {
  return (await input.getFormat()) instanceof IsobmffInputFormat
}

// Frame rate, bitrates, and codecs from packet metadata (no decoding). Each
// value is left out when it cannot be measured.
export async function measureStreamStats(
  videoTrack: InputVideoTrack,
  audioTrack: InputAudioTrack | null,
  fullIndex: boolean
): Promise<StreamStats> {
  const packetCount = fullIndex ? undefined : SAMPLED_PACKET_COUNT
  const stats: StreamStats = {}
  try {
    const video = await videoTrack.computePacketStats(packetCount)
    stats.frameRate = positive(video.averagePacketRate)
    stats.videoBitrate = positive(video.averageBitrate)
    stats.videoCodec = (await videoTrack.getCodec()) ?? undefined
  } catch {
    // Stats only tune the export; a source without them still imports.
  }
  if (audioTrack) {
    try {
      const audio = await audioTrack.computePacketStats(packetCount)
      stats.audioBitrate = positive(audio.averageBitrate)
      stats.audioCodec = (await audioTrack.getCodec()) ?? undefined
    } catch {
      // As above.
    }
  }
  return stats
}

// Read the container with mediabunny (the same demuxer/decoders the exporter
// uses), so anything that imports is also exportable. Width/height are display
// dimensions: pixel aspect ratio and rotation metadata are already applied.
export async function probeMedia(file: File): Promise<MediaProbe> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
  try {
    const videoTrack = await input.getPrimaryVideoTrack()
    if (!videoTrack) throw new ImportError(`"${file.name}" has no video track.`)
    if (!(await videoTrack.canDecode())) {
      throw new ImportError(
        `"${file.name}" uses a video codec (${videoTrack.codec ?? 'unknown'}) this browser cannot decode.`
      )
    }
    const audioTrack = await input.getPrimaryAudioTrack()
    const hasAudio = audioTrack ? await audioTrack.canDecode() : false
    const tracks = audioTrack && hasAudio ? [videoTrack, audioTrack] : [videoTrack]
    const duration = await input.computeDuration(tracks)
    const stats = await measureStreamStats(
      videoTrack,
      audioTrack && hasAudio ? audioTrack : null,
      await hasPacketIndex(input)
    )
    return {
      ...stats,
      duration,
      width: videoTrack.displayWidth,
      height: videoTrack.displayHeight,
      // Frame stepping needs some rate; the default stands in when unmeasured.
      frameRate: stats.frameRate ?? DEFAULT_FRAME_RATE,
      hasAudio,
    }
  } catch (err) {
    if (err instanceof ImportError) throw err
    throw new ImportError(
      `Could not read "${file.name}". The file may be damaged or in an unsupported format.`
    )
  } finally {
    input.dispose()
  }
}

// Confirm the browser's own <video> element can play the file: the preview
// depends on it. Resolves with the element-reported duration.
export function checkPlayable(url: string, timeoutMs = METADATA_TIMEOUT_MS): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true

    const timer = setTimeout(() => {
      cleanup()
      reject(new ImportError('Timed out reading video metadata.'))
    }, timeoutMs)

    function cleanup() {
      clearTimeout(timer)
      video.onloadedmetadata = null
      video.ondurationchange = null
      video.onerror = null
      video.removeAttribute('src')
      video.load()
    }

    video.onloadedmetadata = () => {
      // MediaRecorder output (e.g. screen recordings) can report Infinity;
      // seeking far past the end forces the browser to compute the duration.
      if (!Number.isFinite(video.duration)) {
        video.ondurationchange = () => {
          if (!Number.isFinite(video.duration)) return
          const duration = video.duration
          cleanup()
          resolve(duration)
        }
        video.currentTime = Number.MAX_SAFE_INTEGER
        return
      }
      const duration = video.duration
      cleanup()
      resolve(duration)
    }
    video.onerror = () => {
      cleanup()
      reject(new ImportError('This browser cannot play the file for preview.'))
    }
    video.src = url
  })
}

// Max-abs peaks of `samples` in `peakCount` equal buckets (at least 64).
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

// Stream-decode the audio track and fold it into `peakCount` max-abs buckets
// spread over `duration`. Memory stays bounded by one decoded sample at a time,
// so arbitrarily long files are fine. Returns [] when there is no audio.
export async function extractWaveformPeaks(
  file: File,
  duration: number,
  peakCount = 2000
): Promise<number[]> {
  if (!(duration > 0)) return []
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track || !(await track.canDecode())) return []
    const peaks = new Float32Array(peakCount)
    const sink = new AudioSampleSink(track)
    let scratch = new Float32Array(0)
    for await (const sample of sink.samples()) {
      try {
        const frames = sample.numberOfFrames
        if (scratch.length < frames) scratch = new Float32Array(frames)
        const secondsPerFrame = 1 / sample.sampleRate
        for (let channel = 0; channel < sample.numberOfChannels; channel++) {
          sample.copyTo(scratch, { planeIndex: channel, format: 'f32-planar' })
          for (let frame = 0; frame < frames; frame++) {
            const time = sample.timestamp + frame * secondsPerFrame
            const bucket = Math.floor((time / duration) * peakCount)
            if (bucket < 0 || bucket >= peakCount) continue
            const amp = Math.abs(scratch[frame])
            if (amp > peaks[bucket]) peaks[bucket] = amp
          }
        }
      } finally {
        sample.close()
      }
    }
    return Array.from(peaks)
  } catch {
    return []
  } finally {
    input.dispose()
  }
}

const waveformPending = new Set<string>()

export async function ensureClipWaveform(clipId: string): Promise<void> {
  const clip = getClipById(clipId)
  if (!clip || (clip.waveformPeaks?.length ?? 0) > 0) return
  // A probe that found no decodable audio: nothing to draw.
  if (clip.hasAudio === false) return
  if (waveformPending.has(clipId)) return

  waveformPending.add(clipId)
  try {
    const peaks = await extractWaveformPeaks(clip.file, clip.duration)
    clips.value = clips.value.map((entry) =>
      entry.id === clipId
        ? { ...entry, waveformPeaks: peaks, hasAudio: entry.hasAudio ?? peaks.length > 0 }
        : entry
    )
  } finally {
    waveformPending.delete(clipId)
  }
}

// Probe a file and build a Clip. Returns null when the file is not a usable
// video (logging a user-facing reason). Does not place the clip anywhere. On
// success the caller owns the object URL via the returned clip.
export async function createClip(file: File): Promise<Clip | null> {
  if (!isVideoFile(file)) {
    const message = `Skipped "${file.name}": not a supported video file (MP4, MOV, MKV, WebM).`
    warn(message)
    importErrors.value = [...importErrors.value, message]
    return null
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    info('Importing file', { name: file.name, size: file.size })
    const [probe, playableDuration] = await Promise.all([
      probeMedia(file),
      checkPlayable(objectUrl),
    ])
    const duration =
      Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : playableDuration
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new ImportError(`"${file.name}" reports no playable duration.`)
    }
    if (probe.width <= 0 || probe.height <= 0) {
      throw new ImportError(`"${file.name}" reports invalid video dimensions.`)
    }
    return {
      id: crypto.randomUUID(),
      file,
      name: file.name.replace(/\.[^.]+$/, ''),
      duration,
      width: probe.width,
      height: probe.height,
      frameRate: probe.frameRate,
      objectUrl,
      waveformPeaks: [],
      hasAudio: probe.hasAudio,
      videoBitrate: probe.videoBitrate,
      videoCodec: probe.videoCodec,
      audioBitrate: probe.audioBitrate,
      audioCodec: probe.audioCodec,
    }
  } catch (err) {
    URL.revokeObjectURL(objectUrl)
    const message =
      err instanceof ImportError
        ? err.message
        : `Could not import "${file.name}": ${err instanceof Error ? err.message : String(err)}`
    logError('Import failed', { name: file.name, message })
    importErrors.value = [...importErrors.value, message]
    return null
  }
}

// Batches run one after another, so files land in the order they were picked
// or dropped even when a later, smaller file would probe faster. `importing`
// stays raised until every queued batch is done.
let importQueue: Promise<void> = Promise.resolve()
let pendingBatches = 0

function importBatch(files: File[], place: (clip: Clip) => void): Promise<void> {
  if (files.length === 0) return Promise.resolve()
  pendingBatches += 1
  importing.value = true
  const run = async () => {
    for (const file of files) {
      const clip = await createClip(file)
      if (!clip) continue
      place(clip)
      info('Import succeeded', {
        name: file.name,
        duration: clip.duration,
        videoBitrate: clip.videoBitrate,
        videoCodec: clip.videoCodec,
      })
    }
  }
  const batch = importQueue.then(run).finally(() => {
    pendingBatches -= 1
    if (pendingBatches === 0) importing.value = false
  })
  // Keep the queue alive after a failed batch.
  importQueue = batch.catch(() => {})
  return batch
}

export function importFiles(files: File[]): Promise<void> {
  return importBatch(files, appendClipToTimeline)
}

export function importFilesIntoAdvanced(files: File[], trackId?: string): Promise<void> {
  return importBatch(files, (clip) => {
    appendClipToTrack(clip, trackId)
  })
}

export async function importAndAppend(file: File): Promise<void> {
  return importFiles([file])
}

export async function importIntoAdvanced(file: File, trackId?: string): Promise<void> {
  return importFilesIntoAdvanced([file], trackId)
}
