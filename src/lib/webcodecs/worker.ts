import { probeAudioFormat, runAudioPipeline, type AudioFormat } from './audioPipeline'
import { createDemuxer, probeContainer } from './demux'
import { buildEditPlan } from './editPlan'
import { createWebmMuxer } from './muxWebm'
import {
  UnsupportedSourceError,
  type ExportJob,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol'
import { runVideoPipeline } from './videoPipeline'

let canceled = false

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  ;(self as unknown as Worker).postMessage(message, transfer ?? [])
}

// Total output frames estimated from slice durations times target fps, used to
// drive the progress bar.
function estimateTotalFrames(job: ExportJob): number {
  const fps = job.fps === 'original' ? 30 : Number(job.fps)
  let totalSeconds = 0
  for (const slice of job.slices) totalSeconds += slice.sourceEnd - slice.sourceStart
  return Math.max(1, Math.round(totalSeconds * fps))
}

async function runExport(job: ExportJob): Promise<void> {
  const plan = buildEditPlan(job)
  const totalFrames = estimateTotalFrames(job)
  let framesEncoded = 0
  let lastReported = 0

  const onFrameEncoded = () => {
    framesEncoded++
    const progress = Math.min(0.99, framesEncoded / totalFrames)
    // Throttle progress posts to whole-percent changes.
    if (progress - lastReported >= 0.01) {
      lastReported = progress
      post({ type: 'progress', progress })
    }
  }

  // Initialize one demuxer per source.
  const demuxers = await Promise.all(
    job.sources.map(async (source) => {
      const container = await probeContainer(source.file)
      if (container === 'unsupported') {
        throw new UnsupportedSourceError('Source container is not demuxable')
      }
      const demuxer = await createDemuxer(container)
      const info = await demuxer.init(source.file)
      return { demuxer, info }
    })
  )

  // Determine the real audio output format from the decoder (container metadata
  // can disagree) before configuring the muxer and encoder.
  let audioFormat: AudioFormat = { sampleRate: 48000, numberOfChannels: 2 }
  if (plan.hasAudioOutput) {
    for (const { demuxer, info } of demuxers) {
      if (!info.audio) continue
      const probed = await probeAudioFormat(demuxer, info.audio)
      if (probed) {
        audioFormat = probed
        break
      }
    }
  }

  const muxer = createWebmMuxer(plan, audioFormat.sampleRate, audioFormat.numberOfChannels)

  for (let sourceIndex = 0; sourceIndex < job.sources.length; sourceIndex++) {
    if (canceled) {
      post({ type: 'canceled' })
      return
    }
    const { demuxer, info } = demuxers[sourceIndex]

    await runVideoPipeline({
      demuxer,
      videoInfo: info.video,
      plan,
      sourceIndex,
      muxer,
      onFrameEncoded,
      shouldCancel: () => canceled,
    })

    if (plan.hasAudioOutput && info.audio) {
      await runAudioPipeline({
        demuxer,
        audioInfo: info.audio,
        format: audioFormat,
        plan,
        sourceIndex,
        muxer,
        shouldCancel: () => canceled,
      })
    }
  }

  if (canceled) {
    post({ type: 'canceled' })
    return
  }

  const buffer = muxer.finalize()
  post({ type: 'progress', progress: 1 })
  post({ type: 'done', buffer }, [buffer])
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  if (message.type === 'cancel') {
    canceled = true
    return
  }
  if (message.type === 'export') {
    canceled = false
    runExport(message.job).catch((err: unknown) => {
      const unsupported = err instanceof UnsupportedSourceError
      const text =
        err instanceof Error && err.message === 'canceled'
          ? null
          : err instanceof Error
            ? err.message
            : String(err)
      if (text === null) {
        post({ type: 'canceled' })
      } else {
        post({ type: 'error', message: text, unsupported })
      }
    })
  }
}
