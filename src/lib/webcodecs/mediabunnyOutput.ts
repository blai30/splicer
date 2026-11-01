import {
  AudioSampleSource,
  BufferTarget,
  MkvOutputFormat,
  MovOutputFormat,
  Mp4OutputFormat,
  Output,
  VideoSampleSource,
  WebMOutputFormat,
  type OutputFormat,
} from 'mediabunny'

import type { MbAudioCodec, MbContainer, MbVideoCodec } from '../exportCodecs'

// Every export writes audio in this layout. Encoders need constant parameters,
// so sources with other rates/channel counts are normalized first (see
// audioNormalize.ts).
export const OUTPUT_SAMPLE_RATE = 48_000
export const OUTPUT_CHANNELS = 2

// The encode parameters createOutput reads. Both EditPlan and CompositorPlan
// satisfy this shape structurally.
export type OutputParams = {
  videoCodec: MbVideoCodec
  videoBitrate: number
  keyFrameIntervalUs: number
  // Exact constant output frame rate; null passes source timing through.
  frameRate: number | null
  // The rate frames arrive at on average, for the encoder's rate control.
  nominalFrameRate: number
  hasAudioOutput: boolean
  audioCodec: MbAudioCodec
  audioBitrate: number
}

function outputFormatFor(container: MbContainer): OutputFormat {
  switch (container) {
    case 'mp4':
      // Fast start puts the index up front so the file plays while streaming.
      return new Mp4OutputFormat({ fastStart: 'in-memory' })
    case 'mov':
      return new MovOutputFormat({ fastStart: 'in-memory' })
    case 'mkv':
      return new MkvOutputFormat()
    case 'webm':
      return new WebMOutputFormat()
  }
}

export type OutputHandle = {
  videoSource: VideoSampleSource
  audioSource: AudioSampleSource | null
  start: () => Promise<void>
  finalize: () => Promise<ArrayBuffer>
  cancel: () => Promise<void>
}

// Build a mediabunny Output for the target container with one video source and,
// when the plan has audio, one audio source. mediabunny encodes the samples fed
// to these sources and muxes them into the container.
export function createOutput(plan: OutputParams, container: MbContainer): OutputHandle {
  const output = new Output({ format: outputFormatFor(container), target: new BufferTarget() })

  const videoSource = new VideoSampleSource({
    codec: plan.videoCodec,
    bitrate: plan.videoBitrate,
    keyFrameInterval: plan.keyFrameIntervalUs / 1_000_000,
    // Frames are always drawn at the output size, but guard against drift.
    sizeChangeBehavior: 'contain',
    transform: plan.frameRate ? { frameRate: plan.frameRate } : undefined,
    // mediabunny only tells the encoder a frame rate when the track metadata
    // has one, and that also snaps timestamps (unsafe for variable-rate
    // sources). Without it, Chromium's software encoders assume 30 fps and
    // miss the bitrate by fps/30 (half the size at 15 fps, double at 60).
    // mediabunny configures the encoder with this same config object.
    onEncoderConfig: (config) => {
      config.framerate ??= plan.nominalFrameRate
    },
  })
  output.addVideoTrack(videoSource)

  let audioSource: AudioSampleSource | null = null
  if (plan.hasAudioOutput) {
    audioSource = new AudioSampleSource({ codec: plan.audioCodec, bitrate: plan.audioBitrate })
    output.addAudioTrack(audioSource)
  }

  return {
    videoSource,
    audioSource,
    start: () => output.start(),
    finalize: async () => {
      await output.finalize()
      const buffer = (output.target as BufferTarget).buffer
      if (!buffer) throw new Error('mediabunny output produced no buffer')
      return buffer
    },
    cancel: async () => {
      if (output.state === 'started' || output.state === 'pending') await output.cancel()
    },
  }
}
