import { EtaTracker } from '@/lib/exportEta'
import { cancelExport as cancelFfmpeg, exportVideo } from '@/lib/ffmpeg'
import { info, warn } from '@/lib/logger'
import {
  exportEngineUsed,
  exportEtaSeconds,
  ffmpegProgress,
  getClipById,
  webmCodec,
} from '@/lib/store'
import type { ExportFormat, Framerate, Quality, Segment } from '@/lib/types'
import { webcodecsSupported } from '@/lib/webcodecs/capabilities'
import { probeContainer } from '@/lib/webcodecs/demux'
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

// Resolve the timeline into a serializable job: one source per distinct clip,
// each segment mapped to a slice referencing its source. Returns null when any
// clip is missing (the router then uses ffmpeg).
function buildJob(segments: Segment[], quality: Quality, fps: Framerate): ExportJob | null {
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
  return {
    sources,
    slices: slices as ExportJob['slices'],
    quality,
    fps,
    webmCodec: webmCodec.value,
  }
}

// Up-front gate: every source must be a demuxable container and WebCodecs must
// support the target encode at the output dimensions. Precise source-codec
// decode support is verified inside the worker (it falls back on failure).
async function canRunWebcodecs(job: ExportJob): Promise<boolean> {
  let maxWidth = 0
  let maxHeight = 0
  for (const source of job.sources) {
    const container = await probeContainer(source.file)
    if (container === 'unsupported') return false
    maxWidth = Math.max(maxWidth, source.width)
    maxHeight = Math.max(maxHeight, source.height)
  }
  return webcodecsSupported({
    webmCodec: job.webmCodec,
    width: maxWidth,
    height: maxHeight,
  })
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
        const blob = new Blob([message.buffer], { type: 'video/webm' })
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

  if (format === 'webm' && !forceFfmpeg()) {
    const job = buildJob(segments, quality, fps)
    if (job) {
      try {
        if (await canRunWebcodecs(job)) {
          info('Exporting via WebCodecs engine')
          const result = await runInWorker(job)
          exportEngineUsed.value = 'webcodecs'
          return result
        }
      } catch (err) {
        if (err instanceof Error && err.message === 'canceled') throw err
        const message = err instanceof Error ? err.message : String(err)
        console.warn('[exportEngine] WebCodecs export failed, falling back to ffmpeg:', message)
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
