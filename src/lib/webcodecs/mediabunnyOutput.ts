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

import type { MbContainer } from '../exportCodecs'
import type { EditPlan } from './editPlan'

function outputFormatFor(container: MbContainer): OutputFormat {
  switch (container) {
    case 'mp4':
      return new Mp4OutputFormat()
    case 'mov':
      return new MovOutputFormat()
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
}

// Build a mediabunny Output for the target container with one video source and,
// when the plan has audio, one audio source. mediabunny encodes the samples fed
// to these sources and muxes them into the container.
export function createOutput(plan: EditPlan, container: MbContainer): OutputHandle {
  const output = new Output({ format: outputFormatFor(container), target: new BufferTarget() })

  const videoSource = new VideoSampleSource({
    codec: plan.videoCodec,
    bitrate: plan.videoBitrate,
    keyFrameInterval: plan.keyFrameIntervalUs / 1_000_000,
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
  }
}
