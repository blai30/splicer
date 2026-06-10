import { UnsupportedSourceError } from '../protocol'

export type Vint = { value: number; length: number }

// Read an EBML variable-length integer at offset. When keepMarker is true the
// length-descriptor bit is kept (used for element IDs); otherwise it is masked
// off (used for sizes and values).
export function readVint(bytes: Uint8Array, offset: number, keepMarker = false): Vint {
  const first = bytes[offset]
  if (first === undefined) throw new UnsupportedSourceError('EBML vint out of range')

  let mask = 0x80
  let length = 1
  while (length <= 8 && (first & mask) === 0) {
    mask >>= 1
    length++
  }
  if (length > 8) throw new UnsupportedSourceError('EBML vint too long')

  let value = keepMarker ? first : first & (mask - 1)
  for (let i = 1; i < length; i++) {
    const next = bytes[offset + i]
    if (next === undefined) throw new UnsupportedSourceError('EBML vint truncated')
    value = value * 256 + next
  }
  return { value, length }
}

export type SimpleBlock = {
  trackNumber: number
  relTimestamp: number
  keyframe: boolean
  frame: Uint8Array
}

// Decode a SimpleBlock (or BlockGroup Block) payload: track number vint, signed
// 16-bit relative timestamp, a flags byte, then the frame bytes. Lacing is out
// of scope and rejected.
export function decodeSimpleBlock(payload: Uint8Array): SimpleBlock {
  const track = readVint(payload, 0)
  let offset = track.length

  const high = payload[offset]
  const low = payload[offset + 1]
  if (high === undefined || low === undefined) {
    throw new UnsupportedSourceError('SimpleBlock truncated')
  }
  // Signed 16-bit big-endian.
  let relTimestamp = (high << 8) | low
  if (relTimestamp >= 0x8000) relTimestamp -= 0x10000
  offset += 2

  const flags = payload[offset]
  if (flags === undefined) throw new UnsupportedSourceError('SimpleBlock missing flags')
  offset += 1

  // Bits 0x06 are the lacing field; non-zero lacing is unsupported.
  if ((flags & 0x06) !== 0) {
    throw new UnsupportedSourceError('Laced WebM blocks are not supported')
  }

  const keyframe = (flags & 0x80) !== 0
  return {
    trackNumber: track.value,
    relTimestamp,
    keyframe,
    frame: payload.subarray(offset),
  }
}

// Matroska element IDs used by this parser.
export const ID = {
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimestampScale: 0x2ad7b1,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  Channels: 0x9f,
  Cluster: 0x1f43b675,
  Timestamp: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
} as const

export type EbmlTrack = {
  trackNumber: number
  trackType: number // 1 = video, 2 = audio
  codecId: string
  codecPrivate?: Uint8Array
  width?: number
  height?: number
  samplingFrequency?: number
  channels?: number
}

// Walk the immediate children of a master element body, calling visit for each.
export function walkChildren(
  bytes: Uint8Array,
  start: number,
  end: number,
  visit: (id: number, body: Uint8Array, bodyStart: number) => void
): void {
  let offset = start
  while (offset < end) {
    const id = readVint(bytes, offset, true)
    offset += id.length
    const size = readVint(bytes, offset)
    offset += size.length
    const bodyStart = offset
    const bodyEnd = offset + size.value
    visit(id.value, bytes.subarray(bodyStart, bodyEnd), bodyStart)
    offset = bodyEnd
  }
}

function readUint(bytes: Uint8Array): number {
  let value = 0
  for (const byte of bytes) value = value * 256 + byte
  return value
}

function readFloat(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length === 4) return view.getFloat32(0)
  if (bytes.length === 8) return view.getFloat64(0)
  return readUint(bytes)
}

function readString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

// Parse one TrackEntry body into an EbmlTrack.
export function parseTrackEntry(body: Uint8Array): EbmlTrack {
  const track: EbmlTrack = { trackNumber: 0, trackType: 0, codecId: '' }
  walkChildren(body, 0, body.length, (id, value) => {
    switch (id) {
      case ID.TrackNumber:
        track.trackNumber = readUint(value)
        break
      case ID.TrackType:
        track.trackType = readUint(value)
        break
      case ID.CodecID:
        track.codecId = readString(value)
        break
      case ID.CodecPrivate:
        track.codecPrivate = value.slice()
        break
      case ID.Video:
        walkChildren(value, 0, value.length, (vid, vval) => {
          if (vid === ID.PixelWidth) track.width = readUint(vval)
          if (vid === ID.PixelHeight) track.height = readUint(vval)
        })
        break
      case ID.Audio:
        walkChildren(value, 0, value.length, (aid, aval) => {
          if (aid === ID.SamplingFrequency) track.samplingFrequency = readFloat(aval)
          if (aid === ID.Channels) track.channels = readUint(aval)
        })
        break
    }
  })
  return track
}
