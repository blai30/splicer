import { ensureAacEncoder } from './aacFallback'
import { encodeMix, WindowedMixer } from './compositorAudioMix'
import { buildCompositorPlan, type CompositorPlan } from './compositorPlan'
import type { CompositorJob, CompositorWorkerRequest } from './compositorProtocol'
import { encodeCompositedVideo, type LayerDecoder } from './compositorVideoEncode'
import {
  audioPacketBound,
  createExportTarget,
  doneMessage,
  withReserveFallback,
  type ExportResult,
  type PacketCounts,
} from './exportTarget'
import { openSource, type SourceReader } from './mediabunnyInput'
import { createOutput, OUTPUT_SAMPLE_RATE } from './mediabunnyOutput'
import { UnsupportedSourceError, type WorkerResponse } from './protocol'
import { createTrackPacer } from './trackPacer'

let canceled = false

// Audio is mixed in windows this long, kept about this far ahead of the video.
const MIX_WINDOW_FRAMES = OUTPUT_SAMPLE_RATE
const AUDIO_PACE = { leadSec: 0.5, maxLagSec: 2 }

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  ;(self as unknown as Worker).postMessage(message, transfer ?? [])
}

async function encodeOnce(
  job: CompositorJob,
  plan: CompositorPlan,
  storageDir: string | undefined,
  counts: PacketCounts | null
): Promise<ExportResult> {
  const canvas = new OffscreenCanvas(plan.outputWidth, plan.outputHeight)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2D canvas context available for compositing')
  const exportTarget = await createExportTarget({
    storageDir,
    container: job.container,
    estimatedBytes: ((plan.videoBitrate + plan.audioBitrate) * job.durationSec) / 8,
    packetCounts: counts,
    onStorageFile: (storageName) => post({ type: 'storage', storageName }),
  })
  const out = createOutput(plan, job.container, { exportTarget, packetCounts: counts })

  const durationSec = job.durationSec
  const totalFrames = Math.max(1, Math.ceil(durationSec * plan.fpsGrid))
  const totalAudioFrames = Math.max(0, Math.round(durationSec * OUTPUT_SAMPLE_RATE))
  let framesEncoded = 0
  let audioMixedUntil = 0
  const shouldCancel = () => canceled

  // Audio is mixed and encoded one window at a time just ahead of the video,
  // so the muxer can write both tracks as it goes.
  const mixer = plan.hasMixedAudio
    ? new WindowedMixer(
        job.audioLayers
          .filter((layer) => job.sources[layer.sourceIndex]?.hasAudio)
          .map((layer) => {
            const file = job.sources[layer.sourceIndex].file
            return { layer, fileName: file.name, open: () => openSource(file) }
          }),
        shouldCancel
      )
    : null
  let lastReported = 0
  // Video is most of the work; audio is mixed alongside it, so both count.
  const reportProgress = () => {
    const videoShare = framesEncoded / totalFrames
    const audioShare = mixer && totalAudioFrames > 0 ? audioMixedUntil / totalAudioFrames : 1
    const progress = Math.min(0.98, videoShare * 0.9 + audioShare * 0.08)
    if (progress - lastReported >= 0.01) {
      lastReported = progress
      post({ type: 'progress', progress })
    }
  }
  async function mixAudioUntil(outTimeSec: number) {
    if (!mixer) return
    const target = Math.min(totalAudioFrames, Math.round(outTimeSec * OUTPUT_SAMPLE_RATE))
    while (audioMixedUntil < target) {
      const windowEnd = Math.min(totalAudioFrames, audioMixedUntil + MIX_WINDOW_FRAMES)
      const mix = await mixer.mixWindow(audioMixedUntil, windowEnd)
      await encodeMix(mix, out, shouldCancel, audioMixedUntil)
      audioMixedUntil = windowEnd
      reportProgress()
    }
  }

  const audioPacer = createTrackPacer(mixAudioUntil, AUDIO_PACE)

  // Each layer needs its own decoder (two layers may show the same source at
  // different times), so readers are opened per layer and all disposed at the end.
  const readers: SourceReader[] = []
  try {
    await out.start()
    const decoders: LayerDecoder[] = []
    for (const layer of plan.layers) {
      const reader = await openSource(job.sources[layer.sourceIndex].file)
      readers.push(reader)
      decoders.push({ layer, reader })
    }

    await encodeCompositedVideo(
      decoders,
      plan,
      canvas,
      ctx,
      out,
      durationSec,
      async (outTimeSec) => {
        framesEncoded++
        reportProgress()
        await audioPacer.videoReached(outTimeSec)
      },
      shouldCancel
    )

    if (canceled) throw new Error('canceled')
    await audioPacer.drain()
    await mixAudioUntil(durationSec)
    return await out.finalize()
  } catch (err) {
    // Let in-flight audio stop before its readers are disposed.
    await audioPacer.drain().catch(() => {})
    await out.cancel().catch(() => {})
    throw err
  } finally {
    await mixer?.dispose().catch(() => {})
    for (const reader of readers) reader.dispose()
  }
}

async function runExport(job: CompositorJob, storageDir: string | undefined): Promise<void> {
  const plan = buildCompositorPlan(job)
  await ensureAacEncoder(job.audioCodec)
  // Frames land exactly on the fps grid, so the video count is known.
  const indexed = job.container === 'mp4' || job.container === 'mov'
  const counts: PacketCounts | null = indexed
    ? {
        video: Math.max(1, Math.ceil(job.durationSec * plan.fpsGrid)),
        audio: plan.hasMixedAudio
          ? audioPacketBound(job.durationSec, OUTPUT_SAMPLE_RATE, plan.audioCodec, 0)
          : 0,
      }
    : null
  const result = await withReserveFallback(
    counts,
    (attemptCounts) => encodeOnce(job, plan, storageDir, attemptCounts),
    () => canceled
  )
  post({ type: 'progress', progress: 1 })
  const { message, transfer } = doneMessage(result)
  post(message, transfer)
}

self.onmessage = (event: MessageEvent<CompositorWorkerRequest>) => {
  const message = event.data
  if (message.type === 'cancel') {
    canceled = true
    return
  }
  if (message.type === 'export') {
    canceled = false
    runExport(message.job, message.storageDir).catch((err: unknown) => {
      const unsupported = err instanceof UnsupportedSourceError
      if (canceled || (err instanceof Error && err.message === 'canceled'))
        post({ type: 'canceled' })
      else
        post({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
          unsupported,
        })
    })
  }
}
