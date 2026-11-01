import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from 'mediabunny'

import { buildPacketIndex, type PacketIndex, type PacketMeta } from '@/lib/fastCopy'

// Every video packet's timing, size, and key flag, read from the container
// without decoding. MP4/MOV keep this in their index; Matroska is walked
// cluster by cluster, so this runs only when a stream copy is asked for.
export async function readPacketIndex(file: Blob): Promise<PacketIndex> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('The file has no video track')
    const packets: PacketMeta[] = []
    const sink = new EncodedPacketSink(track)
    for await (const packet of sink.packets(undefined, undefined, { metadataOnly: true })) {
      packets.push({
        timestamp: packet.timestamp,
        duration: packet.duration,
        isKey: packet.type === 'key',
        byteLength: packet.byteLength,
        sequenceNumber: packet.sequenceNumber,
      })
    }
    return buildPacketIndex(packets)
  } finally {
    input.dispose()
  }
}
