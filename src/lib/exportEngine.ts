import { selectCodecs } from '@/lib/exportCodecs'
import { runExportWorker, type ExportOutput } from '@/lib/exportRunner'
import { info } from '@/lib/logger'
import { getClipById, mkvCodec, webmCodec } from '@/lib/store'
import {
  MIME_TYPES,
  type ExportFormat,
  type Framerate,
  type Quality,
  type Segment,
} from '@/lib/types'
import { outputDimensions } from '@/lib/webcodecs/editPlan'
import { jobSourceFromClip, type ExportJob, type JobSource } from '@/lib/webcodecs/protocol'

// Resolve the timeline into a serializable job: one source per distinct clip,
// each segment mapped to a slice referencing its source. Returns null when any
// clip is missing.
export function buildJob(
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
      sources.push(jobSourceFromClip(clip))
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

export async function runExportEngine(
  segments: Segment[],
  format: ExportFormat,
  quality: Quality,
  fps: Framerate
): Promise<ExportOutput & { width: number; height: number }> {
  if (segments.length === 0) throw new Error('Nothing to export: the timeline is empty')

  const job = buildJob(segments, format, quality, fps)
  if (!job)
    throw new Error('A clip on the timeline is no longer available. Re-import it and try again.')

  info('Exporting via WebCodecs engine')
  const { width, height } = outputDimensions(job)
  const output = await runExportWorker(
    () => new Worker(new URL('./webcodecs/worker.ts', import.meta.url), { type: 'module' }),
    job,
    MIME_TYPES[job.format]
  )
  return { ...output, width, height }
}
