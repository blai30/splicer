import { encoderCodecString } from './capabilities'
import type { Demuxer, DemuxChunk, TrackInfo } from './demux'
import type { EditPlan, EditSlice } from './editPlan'
import type { WebmMuxerHandle } from './muxWebm'

const QUEUE_LIMIT = 8

export type VideoPipelineOptions = {
  demuxer: Demuxer
  videoInfo: TrackInfo
  plan: EditPlan
  sourceIndex: number
  muxer: WebmMuxerHandle
  onFrameEncoded: () => void
  shouldCancel: () => boolean
}

// A cropped frame, or one whose source size differs from the output, must be
// redrawn through a canvas; otherwise we only restamp its timestamp.
function needsRedraw(slice: EditSlice, plan: EditPlan, frame: VideoFrame): boolean {
  if (slice.crop) return true
  return frame.displayWidth !== plan.outputWidth || frame.displayHeight !== plan.outputHeight
}

export async function runVideoPipeline(options: VideoPipelineOptions): Promise<void> {
  const { demuxer, videoInfo, plan, sourceIndex, muxer, onFrameEncoded, shouldCancel } = options
  const slices = plan.slices.filter((slice) => slice.sourceIndex === sourceIndex)
  if (slices.length === 0) return

  let pipelineError: unknown = null
  let canvas: OffscreenCanvas | null = null
  let ctx: OffscreenCanvasRenderingContext2D | null = null
  let lastKeyframeUs = Number.NEGATIVE_INFINITY
  const lastEmittedBySlice = new Map<EditSlice, number>()

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      pipelineError ??= err
    },
  })
  encoder.configure({
    codec: encoderCodecString(plan.videoCodec),
    width: plan.outputWidth,
    height: plan.outputHeight,
    bitrate: plan.videoBitrate,
    framerate: plan.frameDurationUs ? Math.round(1_000_000 / plan.frameDurationUs) : 30,
  })

  function sliceForTimestamp(sourceTsUs: number): EditSlice | null {
    for (const slice of slices) {
      const startUs = slice.sourceStart * 1_000_000
      const endUs = slice.sourceEnd * 1_000_000
      if (sourceTsUs >= startUs && sourceTsUs < endUs) return slice
    }
    return null
  }

  function handleFrame(frame: VideoFrame): void {
    const sourceTsUs = frame.timestamp
    const slice = sliceForTimestamp(sourceTsUs)
    if (!slice) return // outside every kept range; drop.

    const sliceStartUs = slice.sourceStart * 1_000_000
    const outTsUs = slice.outStartTimestampUs + (sourceTsUs - sliceStartUs)

    // FPS resampling: skip frames that fall within the same output frame slot.
    if (plan.frameDurationUs) {
      const lastEmitted = lastEmittedBySlice.get(slice) ?? Number.NEGATIVE_INFINITY
      if (outTsUs - lastEmitted < plan.frameDurationUs) return
      lastEmittedBySlice.set(slice, outTsUs)
    }

    let outFrame: VideoFrame
    if (needsRedraw(slice, plan, frame)) {
      if (!canvas || !ctx) {
        canvas = new OffscreenCanvas(plan.outputWidth, plan.outputHeight)
        ctx = canvas.getContext('2d')
      }
      if (!ctx) {
        // No 2d context available; encode the source frame restamped as a fallback.
        outFrame = new VideoFrame(frame, { timestamp: outTsUs })
      } else {
        ctx.clearRect(0, 0, plan.outputWidth, plan.outputHeight)
        if (slice.crop) {
          const { x, y, width, height } = slice.crop
          ctx.drawImage(frame, x, y, width, height, 0, 0, plan.outputWidth, plan.outputHeight)
        } else {
          ctx.drawImage(frame, 0, 0, plan.outputWidth, plan.outputHeight)
        }
        outFrame = new VideoFrame(canvas, { timestamp: outTsUs })
      }
    } else {
      // Re-stamp the timestamp onto the output timeline.
      outFrame = new VideoFrame(frame, { timestamp: outTsUs })
    }

    const keyFrame = outTsUs - lastKeyframeUs >= plan.keyFrameIntervalUs
    if (keyFrame) lastKeyframeUs = outTsUs

    encoder.encode(outFrame, { keyFrame })
    outFrame.close()
    onFrameEncoded()
  }

  const decoder = new VideoDecoder({
    output: (frame) => {
      try {
        handleFrame(frame)
      } catch (err) {
        pipelineError ??= err
      } finally {
        frame.close()
      }
    },
    error: (err) => {
      pipelineError ??= err
    },
  })
  decoder.configure({
    codec: videoInfo.codec,
    description: videoInfo.description,
    codedWidth: videoInfo.width,
    codedHeight: videoInfo.height,
  })

  // The demuxer buffers the whole source, so collect its (compressed, small)
  // chunks first, then feed them with real backpressure between decodes.
  const chunks: DemuxChunk[] = []
  await demuxer.read('video', (chunk) => chunks.push(chunk))

  for (const chunk of chunks) {
    if (shouldCancel()) throw new Error('canceled')
    if (pipelineError) throw pipelineError
    while (decoder.decodeQueueSize > QUEUE_LIMIT || encoder.encodeQueueSize > QUEUE_LIMIT) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (pipelineError) throw pipelineError
      if (shouldCancel()) throw new Error('canceled')
    }
    decoder.decode(
      new EncodedVideoChunk({
        type: chunk.keyframe ? 'key' : 'delta',
        timestamp: chunk.timestampUs,
        duration: chunk.durationUs || undefined,
        data: chunk.data,
      })
    )
  }

  await decoder.flush()
  await encoder.flush()
  decoder.close()
  encoder.close()
  if (pipelineError) throw pipelineError
}
