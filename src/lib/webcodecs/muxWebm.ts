import { ArrayBufferTarget, Muxer } from 'webm-muxer'

import type { EditPlan } from './editPlan'

export type WebmMuxerHandle = {
  addVideoChunk: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void
  addAudioChunk: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void
  finalize: () => ArrayBuffer
}

export function createWebmMuxer(
  plan: EditPlan,
  audioSampleRate: number,
  audioChannels: number
): WebmMuxerHandle {
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: plan.videoCodec === 'vp9' ? 'V_VP9' : 'V_VP8',
      width: plan.outputWidth,
      height: plan.outputHeight,
    },
    audio: plan.hasAudioOutput
      ? { codec: 'A_OPUS', numberOfChannels: audioChannels, sampleRate: audioSampleRate }
      : undefined,
    // Concatenated slices already start at 0 with cumulative timestamps; offset
    // keeps the muxer from rejecting a non-zero first timestamp.
    firstTimestampBehavior: 'offset',
  })

  return {
    addVideoChunk: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    addAudioChunk: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    finalize: () => {
      muxer.finalize()
      return (muxer.target as ArrayBufferTarget).buffer
    },
  }
}
