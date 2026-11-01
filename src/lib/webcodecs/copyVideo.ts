import {
  EncodedPacketSink,
  type EncodedPacket,
  type EncodedVideoPacketSource,
  type InputVideoTrack,
  type Rotation,
  type VideoCodec,
} from 'mediabunny'

import {
  decoderConfigKey,
  planSliceCopy,
  TIME_EPSILON,
  type PacketMeta,
  type SliceCopyPlan,
} from '../fastCopy'
import { UnsupportedSourceError } from './protocol'

// Stream copy of Basic slices: each slice's video packets go to the output as
// they are, re-timed onto the output timeline. Cuts land on key frames, so a
// slice starts at the last key frame at or before its in point.

export type PlannedCopySlice = SliceCopyPlan & {
  // Where the slice starts on the output timeline, from the actual (not the
  // requested) ends of the slices before it, so timestamps stay monotonic.
  outStartSec: number
  // The verified key packet the copy starts from.
  keyPacket: EncodedPacket
}

function packetMeta(packet: EncodedPacket, isKey: boolean): PacketMeta {
  return {
    timestamp: packet.timestamp,
    duration: packet.duration,
    isKey,
    byteLength: packet.byteLength,
    sequenceNumber: packet.sequenceNumber,
  }
}

// Plan one slice from the track's packet metadata. The key packet is checked
// against its bitstream (container key flags can be wrong); the metadata walk
// after it reads no packet data.
export async function planTrackSlice(
  track: InputVideoTrack,
  sourceStart: number,
  sourceEnd: number
): Promise<{ plan: SliceCopyPlan; keyPacket: EncodedPacket }> {
  const sink = new EncodedPacketSink(track)
  const verify = { verifyKeyPackets: true }
  const keyPacket =
    (await sink.getKeyPacket(sourceStart + TIME_EPSILON, verify)) ??
    (await sink.getFirstKeyPacket(verify))
  if (!keyPacket) throw new UnsupportedSourceError('The video has no key frame to copy from')
  const packets: PacketMeta[] = [packetMeta(keyPacket, true)]
  for await (const packet of sink.packets(keyPacket, undefined, { metadataOnly: true })) {
    if (packet.sequenceNumber === keyPacket.sequenceNumber) continue
    if (packet.sequenceNumber < 0) {
      throw new UnsupportedSourceError('The video does not record its decode order')
    }
    packets.push(packetMeta(packet, packet.type === 'key'))
    if (packet.type === 'key' && packet.timestamp >= sourceEnd - TIME_EPSILON) break
  }
  const plan = planSliceCopy(packets, sourceEnd)
  if (!plan) throw new UnsupportedSourceError('The video has no key frame to copy from')
  return { plan, keyPacket }
}

export type CopyTrackInfo = {
  codec: VideoCodec
  decoderConfig: VideoDecoderConfig
  rotation: Rotation
}

// The output track's setup, from the first slice's source. Every other source
// must decode with the same setup, or its packets would be unreadable in
// this track; the export panel checks this too, from the import probe.
export async function copyTrackInfo(tracks: InputVideoTrack[]): Promise<CopyTrackInfo> {
  const [first] = tracks
  if (!first) throw new Error('Nothing to copy')
  const codec = await first.getCodec()
  const decoderConfig = await first.getDecoderConfig()
  if (!codec || !decoderConfig) {
    throw new UnsupportedSourceError('The video codec cannot be copied')
  }
  const key = decoderConfigKey(decoderConfig)
  const rotation = await first.getRotation()
  for (const track of tracks.slice(1)) {
    const config = await track.getDecoderConfig()
    if (!config || decoderConfigKey(config) !== key || (await track.getRotation()) !== rotation) {
      throw new UnsupportedSourceError(
        'Clips were encoded with different settings, so they cannot be copied into one file'
      )
    }
  }
  return { codec, decoderConfig, rotation }
}

export type CopySliceOptions = {
  track: InputVideoTrack
  slice: PlannedCopySlice
  videoSource: EncodedVideoPacketSource
  // Passed with the first packet of the whole export only.
  decoderConfig: VideoDecoderConfig | null
  // Awaited with the output time reached so far, so audio can keep pace.
  onPacket: (outTimeSec: number) => void | Promise<void>
  shouldCancel: () => boolean
}

// Write one planned slice's packets in decode order.
export async function copySlicePackets(options: CopySliceOptions): Promise<void> {
  const { track, slice, videoSource, onPacket, shouldCancel } = options
  let decoderConfig = options.decoderConfig
  const wanted = new Set(slice.sequenceNumbers)
  const lastSequence = slice.sequenceNumbers[slice.sequenceNumbers.length - 1]
  const sink = new EncodedPacketSink(track)
  let reached = slice.outStartSec
  for await (const packet of sink.packets(slice.keyPacket)) {
    if (shouldCancel()) throw new Error('canceled')
    if (packet.sequenceNumber > lastSequence) break
    if (!wanted.has(packet.sequenceNumber)) continue
    const timestamp = slice.outStartSec + (packet.timestamp - slice.snappedStart)
    // The first packet is the verified key; later key flags are checked too,
    // since a false one would make players seek to an undecodable frame.
    const type =
      packet.sequenceNumber === slice.keyPacket.sequenceNumber
        ? 'key'
        : packet.type === 'key'
          ? ((await track.determinePacketType(packet)) ?? 'delta')
          : 'delta'
    await videoSource.add(
      packet.clone({ timestamp, type }),
      decoderConfig ? { decoderConfig } : undefined
    )
    decoderConfig = null
    reached = Math.max(reached, timestamp + packet.duration)
    await onPacket(reached)
  }
}
