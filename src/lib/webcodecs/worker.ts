import { registerAacEncoder } from '@mediabunny/aac-encoder'
import { canEncodeAudio } from 'mediabunny'

import { encodeAudioSlice } from './audioEncode'
import { buildEditPlan } from './editPlan'
import { openSource } from './mediabunnyInput'
import { createOutput } from './mediabunnyOutput'
import {
  UnsupportedSourceError,
  type ExportJob,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol'
import { encodeVideoSlice } from './videoEncode'

let canceled = false

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  ;(self as unknown as Worker).postMessage(message, transfer ?? [])
}

// AAC encode is not native in every browser (notably Firefox). Register the
// mediabunny AAC encoder extension only when the browser lacks native support.
async function ensureAacEncoder(job: ExportJob): Promise<void> {
  if (job.audioCodec === 'aac' && !(await canEncodeAudio('aac'))) {
    registerAacEncoder()
  }
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
  await ensureAacEncoder(job)

  const out = createOutput(plan, job.container)
  await out.start()

  const totalFrames = estimateTotalFrames(job)
  let framesEncoded = 0
  let lastReported = 0
  const onFrameEncoded = () => {
    framesEncoded++
    const progress = Math.min(0.99, framesEncoded / totalFrames)
    if (progress - lastReported >= 0.01) {
      lastReported = progress
      post({ type: 'progress', progress })
    }
  }

  const shouldCancel = () => canceled

  // Slices are in output-timeline order with cumulative timestamps, so feeding
  // them sequentially produces the concatenated output.
  for (const slice of plan.slices) {
    if (canceled) {
      post({ type: 'canceled' })
      return
    }
    const reader = await openSource(job.sources[slice.sourceIndex].file)
    await encodeVideoSlice({ reader, slice, plan, out, onFrameEncoded, shouldCancel })
    if (plan.hasAudioOutput) {
      await encodeAudioSlice({ reader, slice, out, shouldCancel })
    }
  }

  if (canceled) {
    post({ type: 'canceled' })
    return
  }

  const buffer = await out.finalize()
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
      if (err instanceof Error && err.message === 'canceled') {
        post({ type: 'canceled' })
      } else {
        post({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
          unsupported,
        })
      }
    })
  }
}
