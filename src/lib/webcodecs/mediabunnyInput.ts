import { ALL_FORMATS, AudioSampleSink, BlobSource, Input, VideoSampleSink } from 'mediabunny'

import { UnsupportedSourceError } from './protocol'

export type SourceReader = {
  videoSink: VideoSampleSink
  audioSink: AudioSampleSink | null
}

// Open one source file with mediabunny, verifying the primary video track can be
// decoded. Throws UnsupportedSourceError so the worker can fall back to ffmpeg.
export async function openSource(file: File): Promise<SourceReader> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })

  const videoTrack = await input.getPrimaryVideoTrack()
  if (!videoTrack || !(await videoTrack.canDecode())) {
    throw new UnsupportedSourceError('Source video track is not decodable')
  }

  const audioTrack = await input.getPrimaryAudioTrack()
  const audioDecodable = audioTrack ? await audioTrack.canDecode() : false

  return {
    videoSink: new VideoSampleSink(videoTrack),
    audioSink: audioDecodable && audioTrack ? new AudioSampleSink(audioTrack) : null,
  }
}
