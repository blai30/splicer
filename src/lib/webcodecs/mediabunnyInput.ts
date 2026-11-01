import { ALL_FORMATS, AudioSampleSink, BlobSource, Input, VideoSampleSink } from 'mediabunny'

import { UnsupportedSourceError } from './protocol'

export type SourceReader = {
  videoSink: VideoSampleSink
  audioSink: AudioSampleSink | null
  dispose: () => void
}

// Open one source file with mediabunny, verifying the primary video track can be
// decoded. Throws UnsupportedSourceError when the source is not decodable. The
// caller must dispose() the reader when done to release the file.
export async function openSource(file: File): Promise<SourceReader> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
  try {
    const videoTrack = await input.getPrimaryVideoTrack()
    if (!videoTrack || !(await videoTrack.canDecode())) {
      throw new UnsupportedSourceError(`"${file.name}" has no video track this browser can decode`)
    }

    const audioTrack = await input.getPrimaryAudioTrack()
    const audioDecodable = audioTrack ? await audioTrack.canDecode() : false

    return {
      videoSink: new VideoSampleSink(videoTrack),
      audioSink: audioDecodable && audioTrack ? new AudioSampleSink(audioTrack) : null,
      dispose: () => input.dispose(),
    }
  } catch (err) {
    input.dispose()
    throw err
  }
}

// Opens each distinct source at most once per export and disposes them all at
// the end, instead of re-opening the file for every slice that references it.
export class SourceCache {
  private readers = new Map<number, Promise<SourceReader>>()

  constructor(private files: File[]) {}

  get(index: number): Promise<SourceReader> {
    let reader = this.readers.get(index)
    if (!reader) {
      const file = this.files[index]
      if (!file) return Promise.reject(new Error(`Missing source #${index}`))
      reader = openSource(file)
      this.readers.set(index, reader)
    }
    return reader
  }

  async disposeAll(): Promise<void> {
    const pending = [...this.readers.values()]
    this.readers.clear()
    for (const reader of pending) {
      try {
        ;(await reader).dispose()
      } catch {
        // A reader that failed to open has nothing to dispose.
      }
    }
  }
}
