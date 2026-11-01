import { effect } from '@preact/signals'

import { appendClipToTrack } from '@/lib/advanced/advancedSegmentEditing'
import { ImportError } from '@/lib/importError'
import { info, warn, error as logError } from '@/lib/logger'
import { clips, exporting, getClipById, importErrors, importing } from '@/lib/store'
import { appendClipToTimeline } from '@/lib/timelineEditing'
import type { Clip } from '@/lib/types'
import {
  createPauseGate,
  createSerialQueue,
  waveformPeakCount,
  type WaveformRequest,
  type WaveformResponse,
  type WaveformWorkerMessage,
} from '@/lib/waveform'

export const ACCEPTED = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm']
const ACCEPTED_EXTENSIONS = /\.(mp4|m4v|mkv|mov|webm)$/i
export const FILE_INPUT_ACCEPT = 'video/*,.mp4,.m4v,.mkv,.mov,.webm'

const METADATA_TIMEOUT_MS = 15_000

// mediabunny is about half of the editor's JavaScript, and nothing needs it
// before the first import. Loading it on demand keeps it out of first paint;
// prefetchMediaProbe warms it while the page is idle or a file is dragged in.
let mediaProbeModule: Promise<typeof import('@/lib/mediaProbe')> | null = null

export function loadMediaProbe(): Promise<typeof import('@/lib/mediaProbe')> {
  mediaProbeModule ??= import('@/lib/mediaProbe').catch((err: unknown) => {
    // A failed chunk load (offline, a new deploy) may succeed on a later try.
    mediaProbeModule = null
    throw err
  })
  return mediaProbeModule
}

export function prefetchMediaProbe(): void {
  void loadMediaProbe().catch(() => {
    // Only a warm-up: the import that needs it reports a failure.
  })
}

export function isVideoFile(file: File): boolean {
  return ACCEPTED.includes(file.type) || ACCEPTED_EXTENSIONS.test(file.name)
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

// Waveform extraction runs in one long-lived worker, one clip at a time, so a
// batch import never decodes several audio tracks at once. It holds while an
// export runs: decoding in the background slowed an early export by a third.
const waveformGate = createPauseGate()
const enqueueWaveform = createSerialQueue(waveformGate.wait)
let waveformWorker: Worker | null = null
let nextWaveformRequestId = 1
const waveformReplies = new Map<
  number,
  { request: WaveformRequest; resolve: (peaks: Float32Array) => void }
>()

function getWaveformWorker(): Worker | null {
  if (waveformWorker) return waveformWorker
  if (typeof Worker === 'undefined') return null
  try {
    waveformWorker = new Worker(new URL('./webcodecs/waveformWorker.ts', import.meta.url), {
      type: 'module',
    })
  } catch {
    return null
  }
  waveformWorker.onmessage = (event: MessageEvent<WaveformResponse>) => {
    const reply = waveformReplies.get(event.data.id)
    waveformReplies.delete(event.data.id)
    reply?.resolve(event.data.peaks)
  }
  // A worker that fails to load or crashes: finish what was asked on the main
  // thread and stop using it.
  waveformWorker.onerror = () => {
    waveformWorker?.terminate()
    waveformWorker = null
    for (const { request, resolve } of waveformReplies.values()) {
      void extractPeaksHere(request.file, request.duration, request.peakCount).then(resolve, () =>
        resolve(new Float32Array(0))
      )
    }
    waveformReplies.clear()
  }
  return waveformWorker
}

// The main-thread fallback, loaded only when the worker is unavailable.
async function extractPeaksHere(
  file: File,
  duration: number,
  peakCount: number
): Promise<Float32Array> {
  const { extractWaveformPeaks } = await import('@/lib/waveformExtract')
  return extractWaveformPeaks(file, duration, peakCount, waveformGate.wait)
}

function requestPeaks(file: File, duration: number, peakCount: number): Promise<Float32Array> {
  const worker = getWaveformWorker()
  if (!worker) return extractPeaksHere(file, duration, peakCount)
  const id = nextWaveformRequestId++
  const request: WaveformRequest = { id, file, duration, peakCount }
  return new Promise((resolve) => {
    waveformReplies.set(id, { request, resolve })
    const message: WaveformWorkerMessage = { type: 'extract', ...request }
    worker.postMessage(message)
  })
}

// Pause both the queue and an extraction already running in the worker.
effect(() => {
  const paused = exporting.value
  if (paused) waveformGate.pause()
  else waveformGate.resume()
  const message: WaveformWorkerMessage = { type: paused ? 'pause' : 'resume' }
  waveformWorker?.postMessage(message)
})

const waveformPending = new Set<string>()

export async function ensureClipWaveform(clipId: string): Promise<void> {
  const clip = getClipById(clipId)
  if (!clip || (clip.waveformPeaks?.length ?? 0) > 0) return
  // A probe that found no decodable audio: nothing to draw.
  if (clip.hasAudio === false) return
  if (waveformPending.has(clipId)) return

  waveformPending.add(clipId)
  try {
    const peaks = await enqueueWaveform(() =>
      // A clip removed while queued is not decoded.
      getClipById(clipId)
        ? requestPeaks(clip.file, clip.duration, waveformPeakCount(clip.duration))
        : Promise.resolve(new Float32Array(0))
    )
    if (!getClipById(clipId)) return
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
      loadMediaProbe().then(
        ({ probeMedia }) => probeMedia(file),
        () => {
          throw new ImportError(
            `Could not import "${file.name}": the video reader failed to load. Check the connection and try again.`
          )
        }
      ),
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
      rotation: probe.rotation,
      objectUrl,
      waveformPeaks: new Float32Array(0),
      hasAudio: probe.hasAudio,
      videoBitrate: probe.videoBitrate,
      videoCodec: probe.videoCodec,
      audioBitrate: probe.audioBitrate,
      audioCodec: probe.audioCodec,
      decoderConfigKey: probe.decoderConfigKey,
      squarePixels: probe.squarePixels,
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
