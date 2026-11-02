import { selectCodecs } from '@/lib/exportCodecs'
import { runExportWorker, type ExportOutput } from '@/lib/exportRunner'
import { copyBlockers, copySourceFromClip, type CopySource } from '@/lib/fastCopy'
import { info } from '@/lib/logger'
import { getClipById, mkvCodec, webmCodec } from '@/lib/store'
import {
  MIME_TYPES,
  type ExportFormat,
  type Framerate,
  type Quality,
  type QualityChoice,
  type Resolution,
  type Segment,
} from '@/lib/types'
import { buildEditPlan } from '@/lib/webcodecs/editPlan'
import { resolutionShortSide } from '@/lib/webcodecs/outputSize'
import {
  jobSourceFromClip,
  type ExportJob,
  type JobSource,
  type OutputSizing,
} from '@/lib/webcodecs/protocol'

export type SizingOptions = {
  resolution?: Resolution
  // Used when quality is 'target'.
  targetSizeMB?: number
  // Leave the audio track out of the file.
  removeAudio?: boolean
}

// The preset a choice encodes with. Original and Target size still encode
// audio (and, for an Original that cannot copy, video) at High.
export function encodeQuality(choice: QualityChoice): Quality {
  return choice === 'original' || choice === 'target' ? 'high' : choice
}

export function outputSizing(
  choice: QualityChoice,
  { resolution = 'original', targetSizeMB }: SizingOptions
): OutputSizing {
  return {
    maxShortSide: resolutionShortSide(resolution),
    targetBytes:
      choice === 'target' && targetSizeMB && targetSizeMB > 0
        ? Math.round(targetSizeMB * 1_000_000)
        : null,
  }
}

// Why the Basic timeline cannot be stream-copied with these settings (empty
// when it can). Clips not found are left to buildJob to report.
export function timelineCopyBlockers(
  segments: Segment[],
  format: ExportFormat,
  fps: Framerate,
  resolution: Resolution = 'original'
): string[] {
  const copySources: CopySource[] = []
  const indexByClip = new Map<string, number>()
  const slices = []
  for (const segment of segments) {
    const clip = getClipById(segment.clipId)
    if (!clip) continue
    let sourceIndex = indexByClip.get(clip.id)
    if (sourceIndex === undefined) {
      sourceIndex = copySources.length
      indexByClip.set(clip.id, sourceIndex)
      copySources.push(copySourceFromClip(clip))
    }
    slices.push({ sourceIndex, crop: segment.crop })
  }
  return copyBlockers({
    mode: 'basic',
    container: selectCodecs(format, webmCodec.value, mkvCodec.value).container,
    fps,
    resolution,
    slices,
    sources: copySources,
  })
}

// Resolve the timeline into a serializable job: one source per distinct clip,
// each segment mapped to a slice referencing its source. Returns null when any
// clip is missing. Original copies the video only when nothing blocks it (see
// copyBlockers); otherwise it encodes at High, and the panel says why.
export function buildJob(
  segments: Segment[],
  format: ExportFormat,
  quality: QualityChoice,
  fps: Framerate,
  options: SizingOptions = {}
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
      const source = jobSourceFromClip(clip)
      sources.push(options.removeAudio ? { ...source, hasAudio: false } : source)
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
  const jobSlices = slices as ExportJob['slices']
  const selection = selectCodecs(format, webmCodec.value, mkvCodec.value)
  const copy =
    quality === 'original' &&
    timelineCopyBlockers(segments, format, fps, options.resolution).length === 0
  return {
    sources,
    slices: jobSlices,
    quality: encodeQuality(quality),
    fps,
    format,
    container: selection.container,
    videoCodec: selection.videoCodec,
    audioCodec: selection.audioCodec,
    videoMode: copy ? 'copy' : 'encode',
    ...(copy ? {} : outputSizing(quality, options)),
  }
}

export async function runExportEngine(
  segments: Segment[],
  format: ExportFormat,
  quality: QualityChoice,
  fps: Framerate,
  options: SizingOptions = {}
): Promise<ExportOutput & { width: number; height: number }> {
  if (segments.length === 0) throw new Error('Nothing to export: the timeline is empty')

  const job = buildJob(segments, format, quality, fps, options)
  if (!job)
    throw new Error('A clip on the timeline is no longer available. Re-import it and try again.')

  info('Exporting via WebCodecs engine', { videoMode: job.videoMode })
  const plan = buildEditPlan(job)
  const output = await runExportWorker(
    () => new Worker(new URL('./webcodecs/worker.ts', import.meta.url), { type: 'module' }),
    job,
    MIME_TYPES[job.format]
  )
  return { ...output, width: plan.outputWidth, height: plan.outputHeight }
}
