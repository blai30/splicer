import {
  ALL_FORMATS,
  BlobSource,
  Input,
  IsobmffInputFormat,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny'

import { decoderConfigKey } from '@/lib/fastCopy'
import { ImportError } from '@/lib/importError'

// The mediabunny-backed half of import, loaded on demand (see
// loadMediaProbe in videoImport.ts) so the demuxers stay out of first paint.

const DEFAULT_FRAME_RATE = 30
// Packets sampled when the container has no up-front index (MKV/WebM). Enough
// to get past a high-bitrate opening GOP without scanning a long file.
const SAMPLED_PACKET_COUNT = 600

export type StreamStats = {
  frameRate?: number
  videoBitrate?: number
  videoCodec?: string
  audioBitrate?: number
  audioCodec?: string
}

export type MediaProbe = StreamStats & {
  duration: number
  width: number
  height: number
  frameRate: number
  rotation: number
  hasAudio: boolean
  decoderConfigKey?: string
  squarePixels: boolean
}

function positive(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined
}

// MP4/MOV keep a full sample table in metadata, so stats over every packet are
// cheap and immune to an unrepresentative opening. Other containers would have
// to scan the whole file, so they are sampled.
export async function hasPacketIndex(input: Input): Promise<boolean> {
  return (await input.getFormat()) instanceof IsobmffInputFormat
}

// Frame rate, bitrates, and codecs from packet metadata (no decoding). Each
// value is left out when it cannot be measured.
export async function measureStreamStats(
  videoTrack: InputVideoTrack,
  audioTrack: InputAudioTrack | null,
  fullIndex: boolean
): Promise<StreamStats> {
  const packetCount = fullIndex ? undefined : SAMPLED_PACKET_COUNT
  const stats: StreamStats = {}
  try {
    const video = await videoTrack.computePacketStats(packetCount)
    stats.frameRate = positive(video.averagePacketRate)
    stats.videoBitrate = positive(video.averageBitrate)
    stats.videoCodec = (await videoTrack.getCodec()) ?? undefined
  } catch {
    // Stats only tune the export; a source without them still imports.
  }
  if (audioTrack) {
    try {
      const audio = await audioTrack.computePacketStats(packetCount)
      stats.audioBitrate = positive(audio.averageBitrate)
      stats.audioCodec = (await audioTrack.getCodec()) ?? undefined
    } catch {
      // As above.
    }
  }
  return stats
}

// Read the container with mediabunny (the same demuxer/decoders the exporter
// uses), so anything that imports is also exportable. Width/height are display
// dimensions: pixel aspect ratio and rotation metadata are already applied.
export async function probeMedia(file: File): Promise<MediaProbe> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
  try {
    const videoTrack = await input.getPrimaryVideoTrack()
    if (!videoTrack) throw new ImportError(`"${file.name}" has no video track.`)
    if (!(await videoTrack.canDecode())) {
      throw new ImportError(
        `"${file.name}" uses a video codec (${videoTrack.codec ?? 'unknown'}) this browser cannot decode.`
      )
    }
    const audioTrack = await input.getPrimaryAudioTrack()
    const hasAudio = audioTrack ? await audioTrack.canDecode() : false
    const tracks = audioTrack && hasAudio ? [videoTrack, audioTrack] : [videoTrack]
    const duration = await input.computeDuration(tracks)
    const stats = await measureStreamStats(
      videoTrack,
      audioTrack && hasAudio ? audioTrack : null,
      await hasPacketIndex(input)
    )
    const decoderConfig = await videoTrack.getDecoderConfig().catch(() => null)
    const pixelAspect = await videoTrack.getPixelAspectRatio()
    return {
      ...stats,
      decoderConfigKey: decoderConfig ? decoderConfigKey(decoderConfig) : undefined,
      squarePixels: pixelAspect.num === pixelAspect.den,
      duration,
      width: await videoTrack.getDisplayWidth(),
      height: await videoTrack.getDisplayHeight(),
      rotation: await videoTrack.getRotation(),
      // Frame stepping needs some rate; the default stands in when unmeasured.
      frameRate: stats.frameRate ?? DEFAULT_FRAME_RATE,
      hasAudio,
    }
  } catch (err) {
    if (err instanceof ImportError) throw err
    throw new ImportError(
      `Could not read "${file.name}". The file may be damaged or in an unsupported format.`
    )
  } finally {
    input.dispose()
  }
}
