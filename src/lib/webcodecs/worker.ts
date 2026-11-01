import { ensureAacEncoder } from './aacFallback'
import { AudioSliceWriter } from './audioEncode'
import { buildEditPlan, type EditPlan } from './editPlan'
import {
  audioPacketBound,
  createExportTarget,
  doneMessage,
  withReserveFallback,
  type ExportResult,
  type PacketCounts,
} from './exportTarget'
import { canPassThrough } from './framePassthrough'
import { SourceCache } from './mediabunnyInput'
import { createOutput, OUTPUT_SAMPLE_RATE } from './mediabunnyOutput'
import {
  UnsupportedSourceError,
  type ExportJob,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol'
import { createTrackPacer } from './trackPacer'
import { encodeVideoSlice } from './videoEncode'

let canceled = false

// How far audio is written ahead of the video it accompanies, and how far it
// may fall behind before the video waits for it.
const AUDIO_PACE = { leadSec: 0.5, maxLagSec: 2 }

function audioFrameAt(outTimeSec: number): number {
  return Math.round(outTimeSec * OUTPUT_SAMPLE_RATE)
}

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  ;(self as unknown as Worker).postMessage(message, transfer ?? [])
}

class CanceledError extends Error {
  constructor() {
    super('canceled')
  }
}

// Packet bounds for a reserved MP4/MOV index. Constant-rate output emits a
// known number of frames; "original" passes source frames through, counted
// from each source's index (null when a source has none to count from).
async function packetCounts(
  plan: EditPlan,
  sources: SourceCache,
  totalSec: number
): Promise<PacketCounts | null> {
  let video = 0
  for (const slice of plan.slices) {
    const durationSec = slice.sourceEnd - slice.sourceStart
    // One more for the black frame a slice without video holds.
    if (plan.frameRate) video += Math.ceil(durationSec * plan.frameRate) + 1
    else {
      const reader = await sources.get(slice.sourceIndex)
      const frames = await reader.countVideoFrames(slice.sourceStart, slice.sourceEnd)
      if (frames === null) return null
      video += frames + 1
    }
  }
  const audio = plan.hasAudioOutput
    ? audioPacketBound(totalSec, OUTPUT_SAMPLE_RATE, plan.audioCodec, plan.slices.length)
    : 0
  return { video, audio }
}

async function encodeOnce(
  job: ExportJob,
  plan: EditPlan,
  sources: SourceCache,
  storageDir: string | undefined,
  counts: PacketCounts | null,
  totalSec: number
): Promise<ExportResult> {
  const exportTarget = await createExportTarget({
    storageDir,
    container: job.container,
    estimatedBytes: ((plan.videoBitrate + plan.audioBitrate) * totalSec) / 8,
    packetCounts: counts,
    onStorageFile: (storageName) => post({ type: 'storage', storageName }),
  })
  const out = createOutput(plan, job.container, { exportTarget, packetCounts: counts })
  try {
    await out.start()

    let lastReported = 0
    const reportVideoTime = (outTimeSec: number) => {
      // Video carries ~95% of the work; finalize takes the rest.
      const progress = Math.min(0.95, (outTimeSec / totalSec) * 0.95)
      if (progress - lastReported >= 0.005) {
        lastReported = progress
        post({ type: 'progress', progress })
      }
    }
    const shouldCancel = () => canceled

    // Slices are in output-timeline order with cumulative timestamps, so feeding
    // them sequentially produces the concatenated output.
    // Audio is written on one continuous frame grid across slices.
    let audioFrame = 0
    for (const slice of plan.slices) {
      if (canceled) throw new CanceledError()
      const reader = await sources.get(slice.sourceIndex)
      const audio = plan.hasAudioOutput
        ? new AudioSliceWriter({ reader, slice, out, startFrame: audioFrame, shouldCancel })
        : null
      // Keep audio just ahead of the video so the muxer can write both as it
      // goes instead of buffering the slice's video.
      const audioPacer = createTrackPacer(
        async (untilSec) => audio?.advanceTo(audioFrameAt(untilSec)),
        AUDIO_PACE
      )
      try {
        await encodeVideoSlice({
          reader,
          slice,
          plan,
          out,
          onFrameEncoded: async (outTimeSec) => {
            reportVideoTime(outTimeSec)
            if (audio) await audioPacer.videoReached(outTimeSec)
          },
          shouldCancel,
          passThrough: canPassThrough(slice, job.sources[slice.sourceIndex], plan),
        })
        await audioPacer.drain()
        if (audio) audioFrame = await audio.finish()
      } finally {
        // Let in-flight audio stop before its decoder is released.
        await audioPacer.drain().catch(() => {})
        await audio?.dispose()
      }
    }

    if (canceled) throw new CanceledError()
    return await out.finalize()
  } catch (err) {
    await out.cancel().catch(() => {})
    throw err
  }
}

async function runExport(job: ExportJob, storageDir: string | undefined): Promise<void> {
  const plan = buildEditPlan(job)
  await ensureAacEncoder(job.audioCodec)

  const sources = new SourceCache(job.sources.map((source) => source.file))
  try {
    const totalSec = Math.max(
      0.001,
      job.slices.reduce((sum, slice) => sum + (slice.sourceEnd - slice.sourceStart), 0)
    )
    const indexed = job.container === 'mp4' || job.container === 'mov'
    const counts = indexed ? await packetCounts(plan, sources, totalSec) : null
    const result = await withReserveFallback(
      counts,
      (attemptCounts) => encodeOnce(job, plan, sources, storageDir, attemptCounts, totalSec),
      () => canceled
    )
    post({ type: 'progress', progress: 1 })
    const { message, transfer } = doneMessage(result)
    post(message, transfer)
  } finally {
    await sources.disposeAll()
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  if (message.type === 'cancel') {
    canceled = true
    return
  }
  if (message.type === 'export') {
    canceled = false
    runExport(message.job, message.storageDir).catch((err: unknown) => {
      if (
        canceled ||
        err instanceof CanceledError ||
        (err instanceof Error && err.message === 'canceled')
      ) {
        post({ type: 'canceled' })
        return
      }
      post({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
        unsupported: err instanceof UnsupportedSourceError,
      })
    })
  }
}
