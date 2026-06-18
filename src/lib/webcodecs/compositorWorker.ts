import { registerAacEncoder } from '@mediabunny/aac-encoder'
import { canEncodeAudio } from 'mediabunny'

import { encodeAudioSlice } from './audioEncode'
import { buildCompositorPlan } from './compositorPlan'
import type { CompositorJob, CompositorWorkerRequest } from './compositorProtocol'
import { encodeCompositedLayerVideo } from './compositorVideoEncode'
import type { EditSlice } from './editPlan'
import { openSource } from './mediabunnyInput'
import { createOutput } from './mediabunnyOutput'
import { UnsupportedSourceError, type WorkerResponse } from './protocol'

let canceled = false

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  ;(self as unknown as Worker).postMessage(message, transfer ?? [])
}

async function ensureAacEncoder(job: CompositorJob): Promise<void> {
  if (job.audioCodec === 'aac' && !(await canEncodeAudio('aac'))) {
    registerAacEncoder()
  }
}

function estimateTotalFrames(job: CompositorJob): number {
  const fps = job.fps === 'original' ? 30 : Number(job.fps)
  let totalSeconds = 0
  for (const layer of job.layers) totalSeconds += layer.sourceEnd - layer.sourceStart
  return Math.max(1, Math.round(totalSeconds * fps))
}

async function runExport(job: CompositorJob): Promise<void> {
  const plan = buildCompositorPlan(job)
  await ensureAacEncoder(job)

  const out = createOutput(plan, job.container)
  await out.start()

  const canvas = new OffscreenCanvas(plan.outputWidth, plan.outputHeight)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2D canvas context available for compositing')

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

  for (const layer of plan.layers) {
    if (canceled) {
      post({ type: 'canceled' })
      return
    }
    const reader = await openSource(job.sources[layer.sourceIndex].file)
    await encodeCompositedLayerVideo({
      reader,
      layer,
      plan,
      canvas,
      ctx,
      out,
      onFrameEncoded,
      shouldCancel,
    })
    if (plan.hasAudioOutput) {
      const slice: EditSlice = {
        sourceIndex: layer.sourceIndex,
        sourceStart: layer.sourceStart,
        sourceEnd: layer.sourceEnd,
        crop: layer.crop,
        muted: layer.muted,
        outStartTimestampUs: layer.outStartUs,
      }
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

self.onmessage = (event: MessageEvent<CompositorWorkerRequest>) => {
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
