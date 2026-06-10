import { selectCodecs, WEBCODECS_FORMATS } from '@/lib/exportCodecs'
import { EtaTracker } from '@/lib/exportEta'
import { cancelExport as cancelFfmpeg, exportVideo, willStreamCopy } from '@/lib/ffmpeg'
import { info, warn } from '@/lib/logger'
import {
  exportEngineUsed,
  exportEtaSeconds,
  ffmpegProgress,
  getClipById,
  mkvCodec,
  webmCodec,
} from '@/lib/store'
import {
  MIME_TYPES,
  type ExportFormat,
  type Framerate,
  type Quality,
  type Segment,
} from '@/lib/types'
import type { ExportJob, JobSource, WorkerResponse } from '@/lib/webcodecs/protocol'

let activeWorker: Worker | null = null

// A localStorage flag tests use to force the ffmpeg fallback path.
function forceFfmpeg(): boolean {
  try {
    return localStorage.getItem('splicer_force_ffmpeg') === '1'
  } catch {
    return false
  }
}

// Pure decision: which engine should handle this export. Stream-copy-eligible
// exports stay on ffmpeg (instant, lossless); otherwise supported formats
// re-encode through WebCodecs and the rest fall back to ffmpeg.
export function chooseEngine(input: {
  format: ExportFormat
  forceFfmpeg: boolean
  streamCopyEligible: boolean
}): 'webcodecs' | 'ffmpeg' {
  if (input.forceFfmpeg) return 'ffmpeg'
  if (input.streamCopyEligible) return 'ffmpeg'
  return WEBCODECS_FORMATS.includes(input.format) ? 'webcodecs' : 'ffmpeg'
}

// Resolve the timeline into a serializable job: one source per distinct clip,
// each segment mapped to a slice referencing its source. Returns null when any
// clip is missing (the router then uses ffmpeg).
function buildJob(
  segments: Segment[],
  format: ExportFormat,
  quality: Quality,
  fps: Framerate
): ExportJob | null {
  const sources: JobSource[] = []
  const indexByClip = new Map<string, number>()

  const slices = segments.map((segment) => {
    const clip = getClipById(segment.clipId)
    if (!clip) return null
    let sourceIndex = indexByClip.get(segment.clipId)
    if (sourceIndex === undefined) {
      sourceIndex = sources.length
      indexByClip.set(segment.clipId, sourceIndex)
      sources.push({
        file: clip.file,
        width: clip.width,
        height: clip.height,
        hasAudio: clip.hasAudio !== false,
      })
    }
    return {
      sourceIndex,
      sourceStart: segment.startTime,
      sourceEnd: segment.endTime,
      crop: segment.crop,
      muted: segment.muted === true,
    }
  })

  if (slices.some((slice) => slice === null)) return null
  const selection = selectCodecs(format, webmCodec.value, mkvCodec.value)
  return {
    sources,
    slices: slices as ExportJob['slices'],
    quality,
    fps,
    format,
    container: selection.container,
    videoCodec: selection.videoCodec,
    audioCodec: selection.audioCodec,
  }
}

function runInWorker(job: ExportJob): Promise<{ url: string; size: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./webcodecs/worker.ts', import.meta.url), {
      type: 'module',
    })
    activeWorker = worker

    const eta = new EtaTracker()
    ffmpegProgress.value = 0
    exportEtaSeconds.value = null

    const cleanup = () => {
      exportEtaSeconds.value = null
      worker.terminate()
      if (activeWorker === worker) activeWorker = null
    }

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      if (message.type === 'progress') {
        ffmpegProgress.value = message.progress
        eta.sample(message.progress, performance.now())
        exportEtaSeconds.value = eta.etaSeconds(message.progress, performance.now())
      } else if (message.type === 'done') {
        cleanup()
        const blob = new Blob([message.buffer], { type: MIME_TYPES[job.format] })
        ffmpegProgress.value = 1
        resolve({ url: URL.createObjectURL(blob), size: blob.size })
      } else if (message.type === 'canceled') {
        cleanup()
        reject(new Error('canceled'))
      } else if (message.type === 'error') {
        cleanup()
        const err = new Error(message.message) as Error & { unsupported?: boolean }
        err.unsupported = message.unsupported
        reject(err)
      }
    }

    worker.onerror = (event) => {
      cleanup()
      reject(new Error(event.message || 'WebCodecs worker error'))
    }

    worker.postMessage({ type: 'export', job })
  })
}

export async function runExportEngine(
  segments: Segment[],
  format: ExportFormat,
  quality: Quality,
  fps: Framerate
): Promise<{ url: string; size: number }> {
  if (segments.length === 0) throw new Error('No segments')

  const streamCopyEligible = willStreamCopy(segments, format, quality, fps)
  if (chooseEngine({ format, forceFfmpeg: forceFfmpeg(), streamCopyEligible }) === 'webcodecs') {
    const job = buildJob(segments, format, quality, fps)
    if (job) {
      try {
        info('Exporting via WebCodecs engine')
        const result = await runInWorker(job)
        exportEngineUsed.value = 'webcodecs'
        return result
      } catch (err) {
        if (err instanceof Error && err.message === 'canceled') throw err
        const message = err instanceof Error ? err.message : String(err)
        warn('WebCodecs export failed, falling back to ffmpeg', { message })
      }
    }
  }

  info('Exporting via ffmpeg engine')
  const result = await exportVideo(segments, format, quality, fps)
  exportEngineUsed.value = 'ffmpeg'
  return result
}

export function cancelActiveExport(): void {
  if (activeWorker) {
    activeWorker.postMessage({ type: 'cancel' })
    activeWorker.terminate()
    activeWorker = null
  }
  cancelFfmpeg()
  ffmpegProgress.value = 0
  exportEtaSeconds.value = null
}
