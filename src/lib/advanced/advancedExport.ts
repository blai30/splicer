import { mixAdvancedAudio } from '@/lib/advanced/advancedAudioMix'
import { projectDuration } from '@/lib/advanced/advancedTimelineDomain'
import { selectCodecs } from '@/lib/exportCodecs'
import { EtaTracker } from '@/lib/exportEta'
import {
  advancedCanvas,
  advancedSegments,
  advancedTracks,
  exportEtaSeconds,
  exportProgress,
  getClipById,
  mkvCodec,
  webmCodec,
} from '@/lib/store'
import {
  MIME_TYPES,
  type AdvancedSegment,
  type ExportFormat,
  type Framerate,
  type Quality,
} from '@/lib/types'
import type { CompositorJob, WorkerResponse } from '@/lib/webcodecs/compositorProtocol'
import type { JobSource } from '@/lib/webcodecs/protocol'

let activeWorker: Worker | null = null

// Resolve the Advanced project into a serializable compositor job. One source
// per distinct clip; each segment becomes a layer referencing its source.
// Returns null when any clip is missing.
export function buildCompositorJob(
  segments: AdvancedSegment[],
  canvas: { width: number; height: number },
  format: ExportFormat,
  quality: Quality,
  fps: Framerate
): CompositorJob | null {
  const sources: JobSource[] = []
  const indexByClip = new Map<string, number>()

  const layers = segments.map((segment) => {
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
      sourceStart: segment.sourceStart,
      sourceEnd: segment.sourceEnd,
      timelineStart: segment.timelineStart,
      trackId: segment.trackId,
      transform: segment.transform,
      crop: segment.crop,
      muted: segment.muted === true,
      opacity: segment.opacity ?? 1,
    }
  })

  if (layers.some((layer) => layer === null)) return null
  const selection = selectCodecs(format, webmCodec.value, mkvCodec.value)
  return {
    canvas,
    sources,
    layers: layers as CompositorJob['layers'],
    tracksOrder: advancedTracks.value.map((track) => track.id),
    quality,
    fps,
    format,
    container: selection.container,
    videoCodec: selection.videoCodec,
    audioCodec: selection.audioCodec,
  }
}

function runCompositorWorker(job: CompositorJob): Promise<{ url: string; size: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../webcodecs/compositorWorker.ts', import.meta.url), {
      type: 'module',
    })
    activeWorker = worker

    const eta = new EtaTracker()
    exportProgress.value = 0
    exportEtaSeconds.value = null

    const cleanup = () => {
      exportEtaSeconds.value = null
      worker.terminate()
      if (activeWorker === worker) activeWorker = null
    }

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      if (message.type === 'progress') {
        exportProgress.value = message.progress
        eta.sample(message.progress, performance.now())
        exportEtaSeconds.value = eta.etaSeconds(message.progress, performance.now())
      } else if (message.type === 'done') {
        cleanup()
        const blob = new Blob([message.buffer], { type: MIME_TYPES[job.format] })
        exportProgress.value = 1
        resolve({ url: URL.createObjectURL(blob), size: blob.size })
      } else if (message.type === 'canceled') {
        cleanup()
        reject(new Error('canceled'))
      } else if (message.type === 'error') {
        cleanup()
        reject(new Error(message.message))
      }
    }

    worker.onerror = (event) => {
      cleanup()
      reject(new Error(event.message || 'Compositor worker error'))
    }

    worker.postMessage({ type: 'export', job })
  })
}

export async function runAdvancedExport(
  format: ExportFormat,
  quality: Quality,
  fps: Framerate
): Promise<{ url: string; size: number; width: number; height: number; duration: number }> {
  const segments = advancedSegments.value
  if (segments.length === 0) throw new Error('No clips to export')
  const canvas = advancedCanvas.value
  const duration = projectDuration(segments)

  const job = buildCompositorJob(segments, canvas, format, quality, fps)
  if (!job) throw new Error('Missing clip data for export')

  job.mixedAudio = (await mixAdvancedAudio(segments, advancedTracks.value, duration)) ?? undefined

  const result = await runCompositorWorker(job)
  return { ...result, width: canvas.width, height: canvas.height, duration }
}

export function cancelAdvancedExport(): void {
  if (activeWorker) {
    activeWorker.postMessage({ type: 'cancel' })
    activeWorker.terminate()
    activeWorker = null
  }
  exportProgress.value = 0
  exportEtaSeconds.value = null
}
