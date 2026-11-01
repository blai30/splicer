import { ensureAacEncoder } from './aacFallback'
import { AudioSliceWriter } from './audioEncode'
import {
  copySlicePackets,
  copyTrackInfo,
  planTrackSlice,
  type CopyTrackInfo,
  type PlannedCopySlice,
} from './copyVideo'
import { buildEditPlan, type EditPlan, type EditSlice } from './editPlan'
import {
  audioPacketBound,
  createExportTarget,
  doneMessage,
  withReserveFallback,
  type ExportResult,
  type PacketCounts,
} from './exportTarget'
import {
  canPassThroughExport,
  createPassThroughGate,
  withPassThroughFallback,
} from './framePassthrough'
import { SourceCache } from './mediabunnyInput'
import { createCopyOutput, createOutput, OUTPUT_SAMPLE_RATE } from './mediabunnyOutput'
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
  totalSec: number,
  passThrough: boolean
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
    // One gate for the whole export, so every slice's frames share a color space.
    const passThroughGate = passThrough ? createPassThroughGate(plan) : null

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
          passThrough: passThroughGate,
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

// Plan every slice of a stream copy up front: the actual cut points decide
// each slice's output start, the exact packet count for a reserved index, and
// the size.
async function planCopy(
  plan: EditPlan,
  sources: SourceCache
): Promise<{ slices: PlannedCopySlice[]; track: CopyTrackInfo }> {
  const slices: PlannedCopySlice[] = []
  const tracks = []
  let outStartSec = 0
  for (const slice of plan.slices) {
    const reader = await sources.get(slice.sourceIndex)
    tracks.push(reader.videoTrack)
    const { plan: copyPlan, keyPacket } = await planTrackSlice(
      reader.videoTrack,
      slice.sourceStart,
      slice.sourceEnd
    )
    slices.push({ ...copyPlan, outStartSec, keyPacket })
    outStartSec += copyPlan.end - copyPlan.snappedStart
  }
  return { slices, track: await copyTrackInfo(tracks) }
}

async function copyOnce(
  job: ExportJob,
  plan: EditPlan,
  sources: SourceCache,
  copy: { slices: PlannedCopySlice[]; track: CopyTrackInfo },
  storageDir: string | undefined,
  counts: PacketCounts | null,
  totalSec: number
): Promise<ExportResult> {
  const videoBytes = copy.slices.reduce((sum, slice) => sum + slice.byteLength, 0)
  const exportTarget = await createExportTarget({
    storageDir,
    container: job.container,
    estimatedBytes: videoBytes + (plan.audioBitrate * totalSec) / 8,
    packetCounts: counts,
    onStorageFile: (storageName) => post({ type: 'storage', storageName }),
  })
  const out = createCopyOutput(
    {
      copyCodec: copy.track.codec,
      rotation: copy.track.rotation,
      hasAudioOutput: plan.hasAudioOutput,
      audioCodec: plan.audioCodec,
      audioBitrate: plan.audioBitrate,
    },
    job.container,
    { exportTarget, packetCounts: counts }
  )
  try {
    await out.start()
    let lastReported = 0
    const shouldCancel = () => canceled
    let decoderConfig: VideoDecoderConfig | null = copy.track.decoderConfig
    let audioFrame = 0
    for (const [index, copySlice] of copy.slices.entries()) {
      if (canceled) throw new CanceledError()
      const editSlice = plan.slices[index]
      const reader = await sources.get(editSlice.sourceIndex)
      // Audio is re-encoded over exactly the copied span: from the key frame
      // the video starts on to the video's actual end, on the shared grid.
      const outEndSec = copySlice.outStartSec + (copySlice.end - copySlice.snappedStart)
      const audioSlice: EditSlice = {
        ...editSlice,
        sourceStart: copySlice.snappedStart,
        sourceEnd:
          copySlice.snappedStart + (audioFrameAt(outEndSec) - audioFrame) / OUTPUT_SAMPLE_RATE,
        outStartTimestampUs: Math.round(copySlice.outStartSec * 1_000_000),
      }
      const audio = plan.hasAudioOutput
        ? new AudioSliceWriter({
            reader,
            slice: audioSlice,
            out,
            startFrame: audioFrame,
            shouldCancel,
          })
        : null
      const audioPacer = createTrackPacer(
        async (untilSec) => audio?.advanceTo(audioFrameAt(untilSec)),
        AUDIO_PACE
      )
      try {
        await copySlicePackets({
          track: reader.videoTrack,
          slice: copySlice,
          videoSource: out.videoSource,
          decoderConfig,
          onPacket: async (outTimeSec) => {
            // Copying is fast next to the audio encode, which takes the rest.
            const progress = Math.min(0.95, (outTimeSec / totalSec) * 0.95)
            if (progress - lastReported >= 0.005) {
              lastReported = progress
              post({ type: 'progress', progress })
            }
            if (audio) await audioPacer.videoReached(outTimeSec)
          },
          shouldCancel,
        })
        decoderConfig = null
        await audioPacer.drain()
        if (audio) audioFrame = await audio.finish()
      } finally {
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

async function runCopyExport(
  job: ExportJob,
  plan: EditPlan,
  sources: SourceCache,
  storageDir: string | undefined
): Promise<ExportResult> {
  const copy = await planCopy(plan, sources)
  const totalSec = Math.max(
    0.001,
    copy.slices.reduce((sum, slice) => sum + (slice.end - slice.snappedStart), 0)
  )
  const indexed = job.container === 'mp4' || job.container === 'mov'
  const counts: PacketCounts | null = indexed
    ? {
        video: copy.slices.reduce((sum, slice) => sum + slice.sequenceNumbers.length, 0),
        audio: plan.hasAudioOutput
          ? audioPacketBound(totalSec, OUTPUT_SAMPLE_RATE, plan.audioCodec, plan.slices.length)
          : 0,
      }
    : null
  return withReserveFallback(
    counts,
    (attemptCounts) => copyOnce(job, plan, sources, copy, storageDir, attemptCounts, totalSec),
    () => canceled
  )
}

async function runExport(job: ExportJob, storageDir: string | undefined): Promise<void> {
  const plan = buildEditPlan(job)
  await ensureAacEncoder(job.audioCodec)
  if (job.videoMode === 'copy') {
    const sources = new SourceCache(job.sources.map((source) => source.file))
    try {
      const result = await runCopyExport(job, plan, sources, storageDir)
      post({ type: 'progress', progress: 1 })
      const { message, transfer } = doneMessage(result)
      post(message, transfer)
    } finally {
      await sources.disposeAll()
    }
    return
  }

  const sources = new SourceCache(job.sources.map((source) => source.file))
  try {
    const totalSec = Math.max(
      0.001,
      job.slices.reduce((sum, slice) => sum + (slice.sourceEnd - slice.sourceStart), 0)
    )
    const indexed = job.container === 'mp4' || job.container === 'mov'
    const counts = indexed ? await packetCounts(plan, sources, totalSec) : null
    const isCanceled = () => canceled
    const result = await withPassThroughFallback(
      canPassThroughExport(plan.slices, job.sources, plan),
      (passThrough) =>
        withReserveFallback(
          counts,
          (attemptCounts) =>
            encodeOnce(job, plan, sources, storageDir, attemptCounts, totalSec, passThrough),
          isCanceled
        ),
      isCanceled
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
