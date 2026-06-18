import { registerAacEncoder } from '@mediabunny/aac-encoder'
import { AudioSample, canEncodeAudio } from 'mediabunny'

import { buildCompositorPlan } from './compositorPlan'
import type { CompositorJob, CompositorWorkerRequest } from './compositorProtocol'
import { encodeCompositedVideo, type LayerDecoder } from './compositorVideoEncode'
import { openSource } from './mediabunnyInput'
import { createOutput, type OutputHandle } from './mediabunnyOutput'
import { UnsupportedSourceError, type WorkerResponse } from './protocol'

let canceled = false

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  ;(self as unknown as Worker).postMessage(message, transfer ?? [])
}

async function ensureAacEncoder(job: CompositorJob): Promise<void> {
  if (job.audioCodec === 'aac' && !(await canEncodeAudio('aac'))) registerAacEncoder()
}

function projectDuration(job: CompositorJob): number {
  let max = 0
  for (const layer of job.layers) {
    max = Math.max(max, layer.timelineStart + (layer.sourceEnd - layer.sourceStart))
  }
  return max
}

const AUDIO_CHUNK_FRAMES = 4096

async function encodeMixedAudio(job: CompositorJob, out: OutputHandle): Promise<void> {
  const mixed = job.mixedAudio
  if (!mixed || !out.audioSource) return
  const channels = mixed.channelData.length
  const totalFrames = mixed.channelData[0]?.length ?? 0
  for (let start = 0; start < totalFrames; start += AUDIO_CHUNK_FRAMES) {
    if (canceled) throw new Error('canceled')
    const frames = Math.min(AUDIO_CHUNK_FRAMES, totalFrames - start)
    const planar = new Float32Array(frames * channels)
    for (let channel = 0; channel < channels; channel++) {
      planar.set(mixed.channelData[channel].subarray(start, start + frames), channel * frames)
    }
    const sample = new AudioSample({
      format: 'f32-planar',
      sampleRate: mixed.sampleRate,
      numberOfChannels: channels,
      timestamp: start / mixed.sampleRate,
      data: planar,
    })
    await out.audioSource.add(sample)
    sample.close()
  }
}

async function runExport(job: CompositorJob): Promise<void> {
  const plan = buildCompositorPlan(job)
  await ensureAacEncoder(job)

  const out = createOutput(plan, job.container)
  await out.start()

  const canvas = new OffscreenCanvas(plan.outputWidth, plan.outputHeight)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2D canvas context available for compositing')

  const durationSec = projectDuration(job)
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

  const decoders: LayerDecoder[] = []
  for (const layer of plan.layers) {
    decoders.push({ layer, reader: await openSource(job.sources[layer.sourceIndex].file) })
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

  if (canceled) {
    post({ type: 'canceled' })
    return
  }
  if (plan.hasMixedAudio) await encodeMixedAudio(job, out)

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
      if (err instanceof Error && err.message === 'canceled') post({ type: 'canceled' })
      else
        post({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
          unsupported,
        })
    })
  }
}
