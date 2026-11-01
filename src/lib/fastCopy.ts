import type { MbContainer } from '@/lib/exportCodecs'
import type { Clip, CropParams, Framerate, Resolution } from '@/lib/types'
import { resolutionShortSide } from '@/lib/webcodecs/outputSize'

// Stream copy ("Original (no re-encode)"): the source's video packets are
// written to the output as they are, so quality and size match the source.
// Everything here is pure, shared by the export panel and the export worker.

// Containers each codec was verified to copy into (ffprobe and a full ffmpeg
// decode of the output). Anything else re-encodes rather than risk a file
// that does not play. AV1 is left out: nothing here could check it.
export const COPY_CONTAINERS: Record<string, readonly MbContainer[]> = {
  avc: ['mp4', 'mov', 'mkv'],
  hevc: ['mp4', 'mov', 'mkv'],
  vp9: ['webm', 'mkv'],
  vp8: ['webm', 'mkv'],
}

const CODEC_NAMES: Record<string, string> = {
  avc: 'H.264',
  hevc: 'HEVC',
  vp9: 'VP9',
  vp8: 'VP8',
  av1: 'AV1',
}

const CONTAINER_NAMES: Record<MbContainer, string> = {
  mp4: 'MP4',
  mov: 'MOV',
  mkv: 'MKV',
  webm: 'WebM',
}

export function codecDisplayName(codec: string): string {
  return CODEC_NAMES[codec] ?? codec.toUpperCase()
}

// cyrb53: a fast 53-bit string/bytes hash. Collisions only matter between two
// clips the user put on one timeline, so 53 bits is plenty.
function hashBytes(bytes: Uint8Array): string {
  let first = 0xdeadbeef
  let second = 0x41c6ce57
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 2654435761)
    second = Math.imul(second ^ byte, 1597334677)
  }
  first =
    Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909)
  second =
    Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909)
  return (4294967296 * (2097151 & second) + (first >>> 0)).toString(36)
}

function descriptionBytes(description: AllowSharedBufferSource | undefined): Uint8Array | null {
  if (!description) return null
  if (ArrayBuffer.isView(description)) {
    return new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
  }
  return new Uint8Array(description)
}

export type DecoderConfigLike = {
  codec: string
  codedWidth?: number
  codedHeight?: number
  description?: AllowSharedBufferSource
}

// Two tracks whose keys match can share one output track: same codec string
// (profile, level, bit depth), same coded size, and byte-identical
// parameter sets. Clips from one camera can still differ in their SPS.
export function decoderConfigKey(config: DecoderConfigLike): string {
  const description = descriptionBytes(config.description)
  const descriptionPart = description
    ? `${description.byteLength}:${hashBytes(description)}`
    : 'none'
  return `${config.codec}|${config.codedWidth ?? 0}x${config.codedHeight ?? 0}|${descriptionPart}`
}

export type CopySource = {
  name: string
  // mediabunny codec id ('avc', 'vp9', ...); undefined when not probed.
  codec?: string
  decoderConfigKey?: string
  width: number
  height: number
  rotation?: number
  squarePixels?: boolean
}

export function copySourceFromClip(clip: Clip): CopySource {
  return {
    name: clip.name,
    codec: clip.videoCodec,
    decoderConfigKey: clip.decoderConfigKey,
    width: clip.width,
    height: clip.height,
    rotation: clip.rotation,
    squarePixels: clip.squarePixels,
  }
}

export type CopyEligibilityInput = {
  mode: 'basic' | 'advanced'
  container: MbContainer
  fps: Framerate
  resolution: Resolution
  slices: readonly { sourceIndex: number; crop?: CropParams }[]
  sources: readonly CopySource[]
}

function isCropped(crop: CropParams | undefined, source: CopySource): boolean {
  if (!crop) return false
  return !(
    crop.x === 0 &&
    crop.y === 0 &&
    crop.width === source.width &&
    crop.height === source.height
  )
}

// Why the timeline cannot be stream-copied, as sentences for the UI. Empty
// means it can. Copying keeps every byte of the source, so anything that
// changes the picture, its timing, or the decoder setup between clips blocks it.
export function copyBlockers(input: CopyEligibilityInput): string[] {
  if (input.mode === 'advanced') {
    return ['Advanced mode composites layers onto a canvas, so it always re-encodes.']
  }
  if (input.slices.length === 0) return ['Add a clip to the timeline first.']
  const blockers: string[] = []
  const used = [...new Set(input.slices.map((slice) => slice.sourceIndex))]
    .map((index) => input.sources[index])
    .filter((source): source is CopySource => source !== undefined)
  if (used.length === 0) return ['Add a clip to the timeline first.']

  if (input.fps !== 'original') blockers.push('FPS must be Original.')
  // A cap at or above the source's short side changes nothing (capShortSide
  // never upscales), so only a cap that shrinks some clip blocks the copy.
  const maxShortSide = resolutionShortSide(input.resolution)
  if (
    maxShortSide !== null &&
    used.some((source) => Math.min(source.width, source.height) > maxShortSide)
  ) {
    blockers.push(`Resolution must be Original; ${maxShortSide}p shrinks the video.`)
  }
  if (
    input.slices.some((slice) => {
      const source = input.sources[slice.sourceIndex]
      return source !== undefined && isCropped(slice.crop, source)
    })
  ) {
    blockers.push('A segment is cropped.')
  }

  const unknown = used.find((source) => !source.codec || !source.decoderConfigKey)
  if (unknown) {
    blockers.push(`The codec setup of "${unknown.name}" could not be read.`)
    return blockers
  }
  const codecs = [...new Set(used.map((source) => source.codec!))]
  if (codecs.length > 1) {
    blockers.push(`Clips use different codecs (${codecs.map(codecDisplayName).join(', ')}).`)
    return blockers
  }
  const codec = codecs[0]
  if (new Set(used.map((source) => source.decoderConfigKey)).size > 1) {
    blockers.push('Clips were encoded with different settings.')
  }
  if (new Set(used.map((source) => `${source.width}x${source.height}`)).size > 1) {
    blockers.push('Clips have different resolutions.')
  }
  if (new Set(used.map((source) => source.rotation ?? 0)).size > 1) {
    blockers.push('Clips have different rotations.')
  }
  const anamorphic = used.find((source) => source.squarePixels === false)
  if (anamorphic) blockers.push(`"${anamorphic.name}" uses non-square pixels.`)

  const containers = COPY_CONTAINERS[codec]
  if (!containers) {
    blockers.push(`${codecDisplayName(codec)} cannot be copied yet.`)
  } else if (!containers.includes(input.container)) {
    blockers.push(
      `${CONTAINER_NAMES[input.container]} cannot hold ${codecDisplayName(codec)} here; choose ${containers.map((container) => CONTAINER_NAMES[container]).join(' or ')}.`
    )
  }
  return blockers
}

// Packet metadata in decode order, as the container reports it.
export type PacketMeta = {
  timestamp: number
  duration: number
  isKey: boolean
  byteLength: number
  sequenceNumber: number
}

export type SliceCopyPlan = {
  // Presentation time of the key packet the copy starts from.
  snappedStart: number
  // Presentation end of the last copied frame. Usually a frame or two past
  // the requested end, when B-frames there reference a later frame.
  end: number
  // Decode order sequence numbers of the packets to copy.
  sequenceNumbers: number[]
  byteLength: number
}

// Tolerance for float noise between a cut time and a frame timestamp.
export const TIME_EPSILON = 1e-6
// Stand-in frame length when the container gives none.
const FALLBACK_FRAME_SEC = 1 / 30

// Which packets one slice copies, given the packets from its key packet (the
// last key frame at or before the cut) onward in decode order.
//
// - Packets shown before the key frame are open-GOP leading frames that
//   reference the previous GOP, which is not copied, so they are dropped.
// - The copy is a decode-order prefix: every packet up to the last one shown
//   before `end`. B-frames shown before `end` can reference a frame shown
//   after it, so that frame comes along, and so does every frame shown
//   between them, keeping the shown range gap-free.
// - Nothing after the next key frame at or past `end` can be needed.
//
// Returns null when the packets do not start with a key packet.
export function planSliceCopy(
  packets: readonly PacketMeta[],
  sourceEnd: number
): SliceCopyPlan | null {
  return planFromColumns(buildPacketIndex(packets), 0, sourceEnd)
}

// planSliceCopy over packets [from, ...) of an index, reading the columns
// directly so a long slice re-plans quickly while a trim is dragged.
function planFromColumns(
  columns: PacketColumns,
  from: number,
  sourceEnd: number
): SliceCopyPlan | null {
  const { timestamps, durations, byteLengths, sequenceNumbers, isKey } = columns
  const count = timestamps.length
  if (from >= count || isKey[from] !== 1) return null
  const snappedStart = timestamps[from]
  let stop = count
  for (let i = from + 1; i < count; i++) {
    if (isKey[i] === 1 && timestamps[i] >= sourceEnd - TIME_EPSILON) {
      stop = i
      break
    }
  }
  const isLeading = (i: number) => timestamps[i] < snappedStart - TIME_EPSILON

  // The last packet in decode order that is shown before the end.
  let lastIndex = from
  for (let i = from; i < stop; i++) {
    if (!isLeading(i) && timestamps[i] < sourceEnd - TIME_EPSILON) lastIndex = i
  }
  // Grow the prefix until the shown range has no holes: the latest frame it
  // shows sets a bound, and every frame shown up to that bound must be in it.
  let shownUntil = -Infinity
  let scanned = from
  for (;;) {
    for (; scanned <= lastIndex; scanned++) {
      if (!isLeading(scanned)) shownUntil = Math.max(shownUntil, timestamps[scanned])
    }
    let grown = lastIndex
    for (let i = lastIndex + 1; i < stop; i++) {
      if (!isLeading(i) && timestamps[i] <= shownUntil + TIME_EPSILON) grown = i
    }
    if (grown === lastIndex) break
    lastIndex = grown
  }

  const copied: number[] = []
  let byteLength = 0
  let latest = -1
  let shortestDuration = Infinity
  for (let i = from; i <= lastIndex; i++) {
    if (isLeading(i)) continue
    copied.push(sequenceNumbers[i])
    byteLength += byteLengths[i]
    if (latest === -1 || timestamps[i] > timestamps[latest]) latest = i
    if (durations[i] > 0) shortestDuration = Math.min(shortestDuration, durations[i])
  }
  const lastDuration =
    durations[latest] > 0
      ? durations[latest]
      : Number.isFinite(shortestDuration)
        ? shortestDuration
        : FALLBACK_FRAME_SEC
  return {
    snappedStart,
    end: timestamps[latest] + lastDuration,
    sequenceNumbers: copied,
    byteLength,
  }
}

// A whole track's packet metadata in decode order, kept compact so long clips
// stay cheap to hold.
type PacketColumns = {
  timestamps: Float64Array
  durations: Float64Array
  byteLengths: Uint32Array
  sequenceNumbers: Float64Array
  isKey: Uint8Array
}

export type PacketIndex = PacketColumns & {
  // Decode-order positions of the key packets, sorted by presentation time.
  keyPositions: Uint32Array
}

export function buildPacketIndex(packets: readonly PacketMeta[]): PacketIndex {
  const count = packets.length
  const index: PacketIndex = {
    timestamps: new Float64Array(count),
    durations: new Float64Array(count),
    byteLengths: new Uint32Array(count),
    sequenceNumbers: new Float64Array(count),
    isKey: new Uint8Array(count),
    keyPositions: new Uint32Array(0),
  }
  const keys: number[] = []
  packets.forEach((packet, i) => {
    index.timestamps[i] = packet.timestamp
    index.durations[i] = packet.duration
    index.byteLengths[i] = packet.byteLength
    index.sequenceNumbers[i] = packet.sequenceNumber
    index.isKey[i] = packet.isKey ? 1 : 0
    if (packet.isKey) keys.push(i)
  })
  keys.sort((first, second) => index.timestamps[first] - index.timestamps[second])
  index.keyPositions = Uint32Array.from(keys)
  return index
}

// Decode-order position of the last key packet shown at or before `time`, or
// the first key packet when `time` precedes them all; null without keys.
export function keyPositionAtOrBefore(index: PacketIndex, time: number): number | null {
  const keys = index.keyPositions
  if (keys.length === 0) return null
  let low = 0
  let high = keys.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (index.timestamps[keys[middle]] <= time + TIME_EPSILON) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return keys[Math.max(0, found)]
}

// planSliceCopy over an index: what copying [sourceStart, sourceEnd) would
// write. Null when the track has no key packets.
export function planSliceCopyFromIndex(
  index: PacketIndex,
  sourceStart: number,
  sourceEnd: number
): SliceCopyPlan | null {
  const keyPosition = keyPositionAtOrBefore(index, sourceStart)
  return keyPosition === null ? null : planFromColumns(index, keyPosition, sourceEnd)
}

// Above this, a snapped start pulls in enough unwanted footage to warn about
// (screen recordings can have 10 s or longer GOPs).
export const LARGE_SNAP_SHIFT_SEC = 3
