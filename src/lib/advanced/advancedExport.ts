import { projectDuration } from '@/lib/advanced/advancedTimelineDomain'
import { computeExportBounds } from '@/lib/advanced/exportLayout'
import { selectCodecs } from '@/lib/exportCodecs'
import { runExportWorker, type ExportOutput } from '@/lib/exportRunner'
import {
  advancedOutputLock,
  advancedSegments,
  advancedTracks,
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
import type { CompositorJob } from '@/lib/webcodecs/compositorProtocol'
import { jobSourceFromClip, type JobSource } from '@/lib/webcodecs/protocol'

// A hidden track turns its video off; its audio still plays (as in preview).
export function visibleAdvancedSegments(segments: AdvancedSegment[]): AdvancedSegment[] {
  const hiddenTrackIds = new Set(
    advancedTracks.value.filter((track) => track.hidden).map((track) => track.id)
  )
  return segments.filter((segment) => !hiddenTrackIds.has(segment.trackId))
}

// Resolve the Advanced project into a serializable compositor job. One source
// per distinct clip; each segment becomes a layer referencing its source.
// Returns null when any clip is missing.
export function buildCompositorJob(
  segments: AdvancedSegment[],
  format: ExportFormat,
  quality: Quality,
  fps: Framerate
): CompositorJob | null {
  const sources: JobSource[] = []
  const indexByClip = new Map<string, number>()

  // Resolve a clip to its job source index, or null when the clip is gone.
  function sourceFor(clipId: string): number | null {
    const clip = getClipById(clipId)
    if (!clip) return null
    let sourceIndex = indexByClip.get(clipId)
    if (sourceIndex === undefined) {
      sourceIndex = sources.length
      indexByClip.set(clipId, sourceIndex)
      sources.push(jobSourceFromClip(clip))
    }
    return sourceIndex
  }

  const mutedTrackIds = new Set(
    advancedTracks.value.filter((track) => track.muted).map((track) => track.id)
  )

  const visibleSegments = visibleAdvancedSegments(segments)

  const exportBounds = computeExportBounds(visibleSegments, advancedOutputLock.value)
  if (!exportBounds) return null

  const layers: CompositorJob['layers'] = []
  for (const segment of visibleSegments) {
    const sourceIndex = sourceFor(segment.clipId)
    if (sourceIndex === null) return null
    layers.push({
      sourceIndex,
      sourceStart: segment.sourceStart,
      sourceEnd: segment.sourceEnd,
      timelineStart: segment.timelineStart,
      trackId: segment.trackId,
      transform: exportBounds.mapSegment(segment),
      crop: segment.crop,
      muted: segment.muted === true,
      opacity: segment.opacity ?? 1,
    })
  }

  const audioLayers: CompositorJob['audioLayers'] = []
  for (const segment of segments) {
    if (segment.muted || mutedTrackIds.has(segment.trackId)) continue
    const volume = segment.volume ?? 1
    if (volume <= 0) continue
    const sourceIndex = sourceFor(segment.clipId)
    if (sourceIndex === null) return null
    audioLayers.push({
      sourceIndex,
      sourceStart: segment.sourceStart,
      sourceEnd: segment.sourceEnd,
      timelineStart: segment.timelineStart,
      volume,
    })
  }

  const selection = selectCodecs(format, webmCodec.value, mkvCodec.value)
  return {
    canvas: { width: exportBounds.width, height: exportBounds.height },
    sources,
    layers,
    audioLayers,
    durationSec: projectDuration(segments),
    tracksOrder: advancedTracks.value.map((track) => track.id),
    quality,
    fps,
    format,
    container: selection.container,
    videoCodec: selection.videoCodec,
    audioCodec: selection.audioCodec,
  }
}

export async function runAdvancedExport(
  format: ExportFormat,
  quality: Quality,
  fps: Framerate
): Promise<ExportOutput & { width: number; height: number; duration: number }> {
  const segments = advancedSegments.value
  if (segments.length === 0) throw new Error('Nothing to export: add a clip first')
  const duration = projectDuration(segments)

  const job = buildCompositorJob(segments, format, quality, fps)
  if (!job) {
    throw new Error(
      'Nothing visible to export, or a placed clip is no longer available. Check hidden tracks.'
    )
  }

  const result = await runExportWorker(
    () =>
      new Worker(new URL('../webcodecs/compositorWorker.ts', import.meta.url), { type: 'module' }),
    job,
    MIME_TYPES[job.format]
  )
  return { ...result, width: job.canvas.width, height: job.canvas.height, duration }
}
