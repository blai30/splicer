export type Container = 'mp4' | 'webm' | 'unsupported'

export type TrackInfo = {
  // WebCodecs codec string for the decoder.
  codec: string
  // Codec-private data for the decoder config (avcC/hvcC for MP4, CodecPrivate
  // for WebM). Undefined when the codec needs none.
  description?: Uint8Array
  width?: number
  height?: number
  sampleRate?: number
  numberOfChannels?: number
}

export type DemuxTrackInfo = {
  video: TrackInfo
  audio?: TrackInfo
}

export type DemuxChunk = {
  data: Uint8Array
  timestampUs: number
  durationUs: number
  keyframe: boolean
}

// Both demuxers implement this so the pipeline does not care about the
// container. read streams the whole track; the pipeline handles range and
// keyframe selection by routing frames to slices.
export interface Demuxer {
  init(file: File): Promise<DemuxTrackInfo>
  read(track: 'video' | 'audio', onChunk: (chunk: DemuxChunk) => void): Promise<void>
  cancel(): void
}

// Sniff the container from the first bytes. ISOBMFF has 'ftyp' at offset 4;
// EBML/Matroska starts with 0x1A45DFA3.
export async function probeContainer(file: File): Promise<Container> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return 'webm'
  }
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) {
    return 'mp4'
  }
  return 'unsupported'
}

// Factory: import the concrete demuxer lazily so the worker bundle only pulls
// in what the source needs.
export async function createDemuxer(container: Container): Promise<Demuxer> {
  if (container === 'mp4') {
    const { Mp4Demuxer } = await import('./mp4Demuxer')
    return new Mp4Demuxer()
  }
  if (container === 'webm') {
    const { WebmDemuxer } = await import('./webmDemuxer')
    return new WebmDemuxer()
  }
  throw new Error(`Unsupported container: ${container}`)
}
