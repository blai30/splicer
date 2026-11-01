import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  EncodedPacketSink,
  Input,
  IsobmffInputFormat,
  VideoSampleSink,
  type InputVideoTrack,
} from 'mediabunny'

import { UnsupportedSourceError } from './protocol'

export type SourceReader = {
  videoTrack: InputVideoTrack
  videoSink: VideoSampleSink
  audioSink: AudioSampleSink | null
  // Video frames shown in [start, end), counted from the container index;
  // null when the container has no up-front index (MKV/WebM would need a scan).
  countVideoFrames: (start: number, end: number) => Promise<number | null>
  dispose: () => void
}

// Packets whose display span overlaps [start, end), walking decode order from
// the key packet at or before `start`. B-frames make presentation times
// non-monotonic in decode order, so the walk ends at the first key packet past
// `end` rather than the first packet past it.
export async function countPacketsInRange(
  track: InputVideoTrack,
  start: number,
  end: number
): Promise<number> {
  const sink = new EncodedPacketSink(track)
  const options = { metadataOnly: true }
  const first = (await sink.getKeyPacket(start, options)) ?? (await sink.getFirstPacket(options))
  if (!first) return 0
  let count = 0
  for await (const packet of sink.packets(first, undefined, options)) {
    if (packet.type === 'key' && packet.timestamp >= end) break
    if (packet.timestamp < end && packet.timestamp + packet.duration > start) count++
  }
  return count
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

    const indexed = (await input.getFormat()) instanceof IsobmffInputFormat
    return {
      videoTrack,
      videoSink: new VideoSampleSink(videoTrack),
      audioSink: audioDecodable && audioTrack ? new AudioSampleSink(audioTrack) : null,
      countVideoFrames: async (start, end) =>
        indexed ? countPacketsInRange(videoTrack, start, end) : null,
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
