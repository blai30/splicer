import type { Demuxer, DemuxChunk, TrackInfo } from './demux'
import type { EditPlan, EditSlice } from './editPlan'
import type { WebmMuxerHandle } from './muxWebm'

const QUEUE_LIMIT = 8

export type AudioFormat = { sampleRate: number; numberOfChannels: number }

// Decode the first audio packet to learn the real output format. The container
// metadata (mp4box channel_count, etc.) can disagree with what the decoder
// actually produces (mono sources, AAC SBR), so the decoder is authoritative.
export function probeAudioFormat(
  demuxer: Demuxer,
  audioInfo: TrackInfo
): Promise<AudioFormat | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: AudioFormat | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const decoder = new AudioDecoder({
      output: (data) => {
        const format: AudioFormat = {
          sampleRate: data.sampleRate,
          numberOfChannels: data.numberOfChannels,
        }
        data.close()
        try {
          decoder.close()
        } catch {
          // Already closing.
        }
        finish(format)
      },
      error: () => finish(null),
    })
    decoder.configure({
      codec: audioInfo.codec,
      sampleRate: audioInfo.sampleRate ?? 48000,
      numberOfChannels: audioInfo.numberOfChannels ?? 2,
      description: audioInfo.description,
    })

    demuxer
      .read('audio', (chunk) => {
        if (settled) return
        try {
          decoder.decode(
            new EncodedAudioChunk({
              type: chunk.keyframe ? 'key' : 'delta',
              timestamp: chunk.timestampUs,
              duration: chunk.durationUs || undefined,
              data: chunk.data,
            })
          )
        } catch {
          finish(null)
        }
      })
      .then(() => decoder.flush())
      .then(() => finish(null))
      .catch(() => finish(null))
  })
}

export type AudioPipelineOptions = {
  demuxer: Demuxer
  audioInfo: TrackInfo
  format: AudioFormat
  plan: EditPlan
  sourceIndex: number
  muxer: WebmMuxerHandle
  shouldCancel: () => boolean
}

export async function runAudioPipeline(options: AudioPipelineOptions): Promise<void> {
  const { demuxer, audioInfo, format, plan, sourceIndex, muxer, shouldCancel } = options
  if (!plan.hasAudioOutput) return
  const slices = plan.slices.filter((slice) => slice.sourceIndex === sourceIndex)
  if (slices.length === 0) return

  const sampleRate = format.sampleRate
  const channels = format.numberOfChannels
  let pipelineError: unknown = null

  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (err) => {
      pipelineError ??= err
    },
  })
  encoder.configure({
    codec: 'opus',
    sampleRate,
    numberOfChannels: channels,
    bitrate: plan.audioBitrate,
  })

  function sliceForTimestamp(sourceTsUs: number): EditSlice | null {
    for (const slice of slices) {
      const startUs = slice.sourceStart * 1_000_000
      const endUs = slice.sourceEnd * 1_000_000
      if (sourceTsUs >= startUs && sourceTsUs < endUs) return slice
    }
    return null
  }

  function handleAudio(data: AudioData): void {
    const sourceTsUs = data.timestamp
    const slice = sliceForTimestamp(sourceTsUs)
    if (!slice) return

    const sliceStartUs = slice.sourceStart * 1_000_000
    const outTsUs = slice.outStartTimestampUs + (sourceTsUs - sliceStartUs)

    if (slice.muted) {
      // Replace samples with silence of the same shape to keep A/V aligned.
      const silence = new Float32Array(data.numberOfFrames * data.numberOfChannels)
      const silentData = new AudioData({
        format: 'f32-planar',
        sampleRate: data.sampleRate,
        numberOfFrames: data.numberOfFrames,
        numberOfChannels: data.numberOfChannels,
        timestamp: outTsUs,
        data: silence,
      })
      encoder.encode(silentData)
      silentData.close()
      return
    }

    // Re-stamp onto the output timeline by copying planar samples into a new
    // AudioData at the output timestamp.
    const planar = new Float32Array(data.numberOfFrames * data.numberOfChannels)
    for (let channel = 0; channel < data.numberOfChannels; channel++) {
      const offset = channel * data.numberOfFrames
      data.copyTo(planar.subarray(offset, offset + data.numberOfFrames), {
        planeIndex: channel,
        format: 'f32-planar',
      })
    }
    const retimed = new AudioData({
      format: 'f32-planar',
      sampleRate: data.sampleRate,
      numberOfFrames: data.numberOfFrames,
      numberOfChannels: data.numberOfChannels,
      timestamp: outTsUs,
      data: planar,
    })
    encoder.encode(retimed)
    retimed.close()
  }

  const decoder = new AudioDecoder({
    output: (data) => {
      try {
        handleAudio(data)
      } catch (err) {
        pipelineError ??= err
      } finally {
        data.close()
      }
    },
    error: (err) => {
      pipelineError ??= err
    },
  })
  decoder.configure({
    codec: audioInfo.codec,
    sampleRate,
    numberOfChannels: channels,
    description: audioInfo.description,
  })

  const chunks: DemuxChunk[] = []
  await demuxer.read('audio', (chunk) => chunks.push(chunk))

  for (const chunk of chunks) {
    if (shouldCancel()) throw new Error('canceled')
    if (pipelineError) throw pipelineError
    while (decoder.decodeQueueSize > QUEUE_LIMIT || encoder.encodeQueueSize > QUEUE_LIMIT) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (pipelineError) throw pipelineError
      if (shouldCancel()) throw new Error('canceled')
    }
    decoder.decode(
      new EncodedAudioChunk({
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
