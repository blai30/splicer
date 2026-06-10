import { UnsupportedSourceError } from '../protocol'
import {
  decodeSimpleBlock,
  ID,
  parseTrackEntry,
  readVint,
  walkChildren,
  type EbmlTrack,
} from './ebml'
import type { Demuxer, DemuxChunk, DemuxTrackInfo, TrackInfo } from './index'

// Map a Matroska CodecID to a WebCodecs codec string.
function webcodecsCodec(codecId: string): string {
  if (codecId === 'V_VP8') return 'vp8'
  if (codecId === 'V_VP9') return 'vp09.00.10.08'
  if (codecId === 'A_OPUS') return 'opus'
  throw new UnsupportedSourceError(`Unsupported WebM codec: ${codecId}`)
}

export class WebmDemuxer implements Demuxer {
  private bytes: Uint8Array | null = null
  private timestampScaleNs = 1_000_000 // default 1ms
  private videoTrack: EbmlTrack | null = null
  private audioTrack: EbmlTrack | null = null
  private segmentStart = 0
  private segmentEnd = 0
  private canceled = false

  async init(file: File): Promise<DemuxTrackInfo> {
    this.bytes = new Uint8Array(await file.arrayBuffer())
    const bytes = this.bytes

    // Find the Segment element and walk its top-level children for Info/Tracks.
    let offset = 0
    let segmentBodyStart = -1
    let segmentBodyEnd = -1
    while (offset < bytes.length) {
      const id = readVint(bytes, offset, true)
      offset += id.length
      const size = readVint(bytes, offset)
      offset += size.length
      if (id.value === ID.Segment) {
        segmentBodyStart = offset
        segmentBodyEnd = offset + size.value
        break
      }
      offset += size.value
    }
    if (segmentBodyStart < 0) throw new UnsupportedSourceError('No Matroska Segment found')
    this.segmentStart = segmentBodyStart
    this.segmentEnd = Math.min(segmentBodyEnd, bytes.length)

    walkChildren(bytes, this.segmentStart, this.segmentEnd, (id, body) => {
      if (id === ID.Info) {
        walkChildren(body, 0, body.length, (infoId, infoVal) => {
          if (infoId === ID.TimestampScale) {
            let scale = 0
            for (const byte of infoVal) scale = scale * 256 + byte
            this.timestampScaleNs = scale
          }
        })
      } else if (id === ID.Tracks) {
        walkChildren(body, 0, body.length, (trackId, trackBody) => {
          if (trackId !== ID.TrackEntry) return
          const track = parseTrackEntry(trackBody)
          if (track.trackType === 1 && !this.videoTrack) this.videoTrack = track
          if (track.trackType === 2 && !this.audioTrack) this.audioTrack = track
        })
      }
    })

    if (!this.videoTrack) throw new UnsupportedSourceError('WebM has no video track')

    const toTrackInfo = (track: EbmlTrack): TrackInfo => ({
      codec: webcodecsCodec(track.codecId),
      description: track.codecPrivate,
      width: track.width,
      height: track.height,
      sampleRate: track.samplingFrequency,
      numberOfChannels: track.channels,
    })

    const result: DemuxTrackInfo = { video: toTrackInfo(this.videoTrack) }
    if (this.audioTrack) result.audio = toTrackInfo(this.audioTrack)
    return result
  }

  async read(track: 'video' | 'audio', onChunk: (chunk: DemuxChunk) => void): Promise<void> {
    const bytes = this.bytes
    if (!bytes) throw new Error('Demuxer not initialized')
    const wanted = track === 'video' ? this.videoTrack : this.audioTrack
    if (!wanted) return
    const scaleUs = this.timestampScaleNs / 1000 // ns to us per tick

    // Walk Clusters. Each Cluster has a Timestamp then SimpleBlock/BlockGroup.
    walkChildren(bytes, this.segmentStart, this.segmentEnd, (id, body) => {
      if (this.canceled) return
      if (id !== ID.Cluster) return
      let clusterTimestamp = 0
      walkChildren(body, 0, body.length, (cid, cval) => {
        if (this.canceled) return
        if (cid === ID.Timestamp) {
          let ts = 0
          for (const byte of cval) ts = ts * 256 + byte
          clusterTimestamp = ts
          return
        }
        let blockPayload: Uint8Array | null = null
        if (cid === ID.SimpleBlock) {
          blockPayload = cval
        } else if (cid === ID.BlockGroup) {
          walkChildren(cval, 0, cval.length, (bid, bval) => {
            if (bid === ID.Block) blockPayload = bval
          })
        }
        if (!blockPayload) return
        const block = decodeSimpleBlock(blockPayload)
        if (block.trackNumber !== wanted.trackNumber) return
        const absoluteTicks = clusterTimestamp + block.relTimestamp
        onChunk({
          data: block.frame,
          timestampUs: Math.round(absoluteTicks * scaleUs),
          durationUs: 0, // WebM blocks carry no per-frame duration; decoder infers.
          keyframe: block.keyframe,
        })
      })
    })
  }

  cancel(): void {
    this.canceled = true
  }
}
