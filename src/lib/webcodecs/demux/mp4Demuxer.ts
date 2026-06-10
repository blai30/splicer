import {
  createFile,
  DataStream,
  Endianness,
  MP4BoxBuffer,
  type ISOFile,
  type Movie,
  type Sample,
  type Track,
} from 'mp4box'

import { UnsupportedSourceError } from '../protocol'
import type { Demuxer, DemuxChunk, DemuxTrackInfo, TrackInfo } from './index'

// MPEG-4 descriptor tags for digging out the AAC AudioSpecificConfig.
const TAG_DECODER_CONFIG = 0x04
const TAG_DECODER_SPECIFIC_INFO = 0x05

// Serialize a codec-config box (avcC/hvcC) to its raw bytes, stripping the
// 8-byte box header so it matches what the WebCodecs decoder expects.
function writeBoxBody(box: { write(stream: DataStream): void }): Uint8Array {
  const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN)
  box.write(stream)
  return new Uint8Array(stream.buffer).subarray(8)
}

function videoDescription(file: ISOFile, trackId: number): Uint8Array | undefined {
  const trak = file.getTrackById(trackId)
  const entry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0] as
    | { avcC?: { write(s: DataStream): void }; hvcC?: { write(s: DataStream): void } }
    | undefined
  if (!entry) return undefined
  if (entry.avcC) return writeBoxBody(entry.avcC)
  if (entry.hvcC) return writeBoxBody(entry.hvcC)
  // VP8/VP9/AV1 in MP4 carry profile/level in the codec string; no description.
  return undefined
}

function audioDescription(file: ISOFile, trackId: number): Uint8Array | undefined {
  const trak = file.getTrackById(trackId)
  const entry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0] as
    | { esds?: { esd?: { findDescriptor(tag: number): unknown } } }
    | undefined
  const esd = entry?.esds?.esd
  if (!esd) return undefined
  const decoderConfig = esd.findDescriptor(TAG_DECODER_CONFIG) as
    | { findDescriptor(tag: number): unknown }
    | undefined
  const specificInfo = decoderConfig?.findDescriptor(TAG_DECODER_SPECIFIC_INFO) as
    | { data?: Uint8Array }
    | undefined
  return specificInfo?.data
}

export class Mp4Demuxer implements Demuxer {
  private file: ISOFile | null = null
  private info: Movie | null = null
  private canceled = false

  init(file: File): Promise<DemuxTrackInfo> {
    return new Promise((resolve, reject) => {
      // keepMdatData = true so extracted samples carry their bytes.
      const mp4 = createFile(true)
      this.file = mp4

      mp4.onError = (_module: string, message: string) => {
        reject(new UnsupportedSourceError(`mp4box: ${message}`))
      }

      mp4.onReady = (info: Movie) => {
        this.info = info
        const videoTrack = info.videoTracks[0]
        if (!videoTrack) {
          reject(new UnsupportedSourceError('MP4 has no video track'))
          return
        }

        const result: DemuxTrackInfo = {
          video: {
            codec: videoTrack.codec,
            description: videoDescription(mp4, videoTrack.id),
            width: videoTrack.video?.width ?? videoTrack.track_width,
            height: videoTrack.video?.height ?? videoTrack.track_height,
          },
        }

        const audioTrack = info.audioTracks[0]
        if (audioTrack) {
          const audio: TrackInfo = {
            codec: audioTrack.codec,
            description: audioDescription(mp4, audioTrack.id),
            sampleRate: audioTrack.audio?.sample_rate,
            numberOfChannels: audioTrack.audio?.channel_count,
          }
          result.audio = audio
        }

        resolve(result)
      }

      file
        .arrayBuffer()
        .then((buffer) => {
          mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(buffer, 0))
          mp4.flush()
        })
        .catch(reject)
    })
  }

  read(track: 'video' | 'audio', onChunk: (chunk: DemuxChunk) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const mp4 = this.file
      const info = this.info
      if (!mp4 || !info) {
        reject(new Error('Demuxer not initialized'))
        return
      }

      const target: Track | undefined =
        track === 'video' ? info.videoTracks[0] : info.audioTracks[0]
      if (!target) {
        resolve()
        return
      }

      mp4.onSamples = (id: number, _user: unknown, samples: Array<Sample>) => {
        if (this.canceled || id !== target.id) return
        for (const sample of samples) {
          if (!sample.data) continue
          onChunk({
            data: new Uint8Array(sample.data),
            timestampUs: Math.round((sample.cts / sample.timescale) * 1_000_000),
            durationUs: Math.round((sample.duration / sample.timescale) * 1_000_000),
            keyframe: sample.is_sync,
          })
        }
      }

      try {
        // Seek to the start so each read() re-delivers from sample 0; mp4box
        // sample extraction is otherwise stateful and a second pass (e.g. an
        // audio probe followed by the real audio pass) would yield nothing.
        mp4.seek(0, true)
        // The whole file is already buffered, so start() delivers every sample
        // synchronously through onSamples before it returns.
        mp4.setExtractionOptions(target.id, null, { nbSamples: 1000 })
        mp4.start()
        resolve()
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  cancel(): void {
    this.canceled = true
    try {
      this.file?.stop()
    } catch {
      // Best effort.
    }
  }
}
