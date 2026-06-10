import type { WebmCodec } from '../types'

export type CapabilityQuery = {
  webmCodec: WebmCodec
  width: number
  height: number
  // Set when the source has an audio track the engine must decode.
  audioDecodeCodec?: string
  // Source video codec string (e.g. 'avc1.640028', 'vp8', 'vp09.00.10.08').
  // When undefined the video decode check is skipped (the worker re-checks at
  // init and falls back on failure).
  videoDecodeCodec?: string
}

// The WebCodecs codec string for our two WebM video outputs.
export function encoderCodecString(codec: WebmCodec): string {
  // vp09.00.10.08: profile 0, level 1.0, 8-bit. A broadly supported VP9 string.
  return codec === 'vp9' ? 'vp09.00.10.08' : 'vp8'
}

function globalsPresent(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoDecoder !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioDecoder !== 'undefined'
  )
}

export async function webcodecsSupported(query: CapabilityQuery): Promise<boolean> {
  if (!globalsPresent()) return false
  try {
    const encodeSupport = await VideoEncoder.isConfigSupported({
      codec: encoderCodecString(query.webmCodec),
      width: query.width,
      height: query.height,
      bitrate: 1_000_000,
    })
    if (!encodeSupport.supported) return false

    if (query.videoDecodeCodec) {
      const decodeSupport = await VideoDecoder.isConfigSupported({
        codec: query.videoDecodeCodec,
        codedWidth: query.width,
        codedHeight: query.height,
      })
      if (!decodeSupport.supported) return false
    }

    if (query.audioDecodeCodec) {
      const audioDecodeSupport = await AudioDecoder.isConfigSupported({
        codec: query.audioDecodeCodec,
        sampleRate: 48000,
        numberOfChannels: 2,
      })
      const audioEncodeSupport = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 128_000,
      })
      if (!audioDecodeSupport.supported || !audioEncodeSupport.supported) return false
    }

    return true
  } catch {
    return false
  }
}
