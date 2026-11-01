import { mixAdvancedAudio } from '@/lib/advanced/advancedAudioMix'
import { projectDuration } from '@/lib/advanced/advancedTimelineDomain'
import { computeExportBounds } from '@/lib/advanced/exportLayout'
import { selectCodecs } from '@/lib/exportCodecs'
import { runExportWorker } from '@/lib/exportRunner'
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
import type { JobSource } from '@/lib/webcodecs/protocol'

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

  const hiddenTrackIds = new Set(
    advancedTracks.value.filter((track) => track.hidden).map((track) => track.id)
  )

  const visibleSegments = segments.filter((segment) => !hiddenTrackIds.has(segment.trackId))

  const exportBounds = computeExportBounds(visibleSegments, advancedOutputLock.value)
  if (!exportBounds) return null

  const layers = visibleSegments.map((segment) => {
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
        frameRate: clip.frameRate,
      })
    }
    return {
      sourceIndex,
      sourceStart: segment.sourceStart,
      sourceEnd: segment.sourceEnd,
      timelineStart: segment.timelineStart,
      trackId: segment.trackId,
      transform: exportBounds.mapTransform(segment.transform),
      crop: segment.crop,
      muted: segment.muted === true,
      opacity: segment.opacity ?? 1,
    }
  })

  if (layers.some((layer) => layer === null)) return null
  const selection = selectCodecs(format, webmCodec.value, mkvCodec.value)
  return {
    canvas: { width: exportBounds.width, height: exportBounds.height },
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

export async function runAdvancedExport(
  format: ExportFormat,
  quality: Quality,
  fps: Framerate
): Promise<{ url: string; size: number; width: number; height: number; duration: number }> {
  const segments = advancedSegments.value
  if (segments.length === 0) throw new Error('Nothing to export: add a clip first')
  const duration = projectDuration(segments)

  const job = buildCompositorJob(segments, format, quality, fps)
  if (!job) {
    throw new Error(
      'Nothing visible to export, or a placed clip is no longer available. Check hidden tracks.'
    )
  }

  job.mixedAudio = (await mixAdvancedAudio(segments, advancedTracks.value, duration)) ?? undefined

  const result = await runExportWorker(
    () =>
      new Worker(new URL('../webcodecs/compositorWorker.ts', import.meta.url), { type: 'module' }),
    job,
    MIME_TYPES[job.format]
  )
  return { ...result, width: job.canvas.width, height: job.canvas.height, duration }
}
