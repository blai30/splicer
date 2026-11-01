import { ensureAacEncoder } from './aacFallback'
import { createMixBuffer, encodeMix, mixLayer } from './compositorAudioMix'
import { buildCompositorPlan } from './compositorPlan'
import type { CompositorJob, CompositorWorkerRequest } from './compositorProtocol'
import { encodeCompositedVideo, type LayerDecoder } from './compositorVideoEncode'
import { openSource, type SourceReader } from './mediabunnyInput'
import { createOutput, type OutputHandle } from './mediabunnyOutput'
import { UnsupportedSourceError, type WorkerResponse } from './protocol'

let canceled = false

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  ;(self as unknown as Worker).postMessage(message, transfer ?? [])
}

async function runExport(job: CompositorJob): Promise<void> {
  const plan = buildCompositorPlan(job)
  await ensureAacEncoder(job.audioCodec)

  const out = createOutput(plan, job.container)
  await out.start()

  const canvas = new OffscreenCanvas(plan.outputWidth, plan.outputHeight)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2D canvas context available for compositing')

  const durationSec = job.durationSec
  const totalFrames = Math.max(1, Math.ceil(durationSec * plan.fpsGrid))
  let framesEncoded = 0
  let lastReported = 0
  const onFrameEncoded = () => {
    framesEncoded++
    const progress = Math.min(0.98, framesEncoded / totalFrames)
    if (progress - lastReported >= 0.01) {
      lastReported = progress
      post({ type: 'progress', progress })
    }
  }
  const shouldCancel = () => canceled

  // Each layer needs its own decoder (two layers may show the same source at
  // different times), so readers are opened per layer and all disposed at the end.
  const readers: SourceReader[] = []
  try {
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
      onFrameEncoded,
      shouldCancel
    )

    if (canceled) throw new Error('canceled')
    if (plan.hasMixedAudio) {
      post({ type: 'progress', progress: 0.98 })
      const mix = createMixBuffer(durationSec)
      for (const layer of job.audioLayers) {
        const source = job.sources[layer.sourceIndex]
        if (!source?.hasAudio) continue
        const reader = await openSource(source.file)
        readers.push(reader)
        await mixLayer(mix, layer, reader, source.file.name, shouldCancel)
      }
      await encodeMix(mix, out, shouldCancel)
    }
  } catch (err) {
    await out.cancel().catch(() => {})
    throw err
  } finally {
    for (const reader of readers) reader.dispose()
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
