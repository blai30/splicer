import { registerAacEncoder } from '@mediabunny/aac-encoder'
import { canEncodeAudio } from 'mediabunny'

import { encodeAudioSlice } from './audioEncode'
import { buildEditPlan } from './editPlan'
import { SourceCache } from './mediabunnyInput'
import { createOutput, type OutputHandle } from './mediabunnyOutput'
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

class CanceledError extends Error {
  constructor() {
    super('canceled')
  }
}

async function runExport(job: ExportJob): Promise<void> {
  const plan = buildEditPlan(job)
  await ensureAacEncoder(job)

  const sources = new SourceCache(job.sources.map((source) => source.file))
  let out: OutputHandle | null = null
  try {
    out = createOutput(plan, job.container)
    await out.start()

    const totalSec = Math.max(
      0.001,
      job.slices.reduce((sum, slice) => sum + (slice.sourceEnd - slice.sourceStart), 0)
    )
    let lastReported = 0
    const onFrameEncoded = (outTimeSec: number) => {
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
    for (const slice of plan.slices) {
      if (canceled) throw new CanceledError()
      const reader = await sources.get(slice.sourceIndex)
      await encodeVideoSlice({ reader, slice, plan, out, onFrameEncoded, shouldCancel })
      if (plan.hasAudioOutput) {
        await encodeAudioSlice({ reader, slice, out, shouldCancel })
      }
    }

    if (canceled) throw new CanceledError()
    const buffer = await out.finalize()
    post({ type: 'progress', progress: 1 })
    post({ type: 'done', buffer }, [buffer])
  } catch (err) {
    await out?.cancel().catch(() => {})
    throw err
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
    runExport(message.job).catch((err: unknown) => {
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
