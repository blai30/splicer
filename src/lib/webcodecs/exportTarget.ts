import { BufferTarget, StreamTarget, type StreamTargetChunk, type Target } from 'mediabunny'

import type { MbAudioCodec, MbContainer } from '../exportCodecs'
import { EXPORTS_DIR } from './protocol'

// Large chunks keep the number of disk writes low; mediabunny holds at most a
// few of them in memory at once.
const STREAM_CHUNK_BYTES = 8 * 1024 * 1024
// Room left for the container index, rounding, and other writers to the quota.
const QUOTA_HEADROOM_BYTES = 64 * 1024 * 1024
// The encoder can overshoot its bitrate on hard content.
const SIZE_SAFETY_FACTOR = 1.5

export type ExportResult =
  | { kind: 'file'; file: File; storageName: string }
  | { kind: 'buffer'; buffer: ArrayBuffer }

export type FastStart = 'in-memory' | 'reserve' | false

export type ExportTarget = {
  target: Target
  streaming: boolean
  // Close the output file and hand back what was written.
  finish: () => Promise<ExportResult>
  // Drop whatever was written (cancel, error, retry).
  discard: () => Promise<void>
}

// Upper bounds on packets per track, for MP4/MOV fast start with 'reserve'.
export type PacketCounts = { video: number; audio: number }

// The index placement for MP4/MOV. In memory, the whole file is buffered anyway
// so the index moves to the front for free. Streaming to disk, a reserved
// index needs a packet bound that cannot be undercounted; without one the
// index goes at the end, which is still a valid, playable file.
export function chooseFastStart(streaming: boolean, packetCounts: PacketCounts | null): FastStart {
  if (!streaming) return 'in-memory'
  return packetCounts ? 'reserve' : false
}

// A packet bound with margin, as mediabunny recommends: running past it fails
// the export, while each spare entry costs only a few dozen bytes.
export function packetBudget(expectedPackets: number): number {
  return Math.ceil(Math.max(0, expectedPackets) * 1.25) + 32
}

// The space mediabunny sets aside up front for a reserved index: its worst case
// for each sample table, per packet of each track's budget.
export function reservedIndexBytes(packetCounts: PacketCounts): number {
  let bytes = 0
  for (const expected of [packetCounts.video, packetCounts.audio]) {
    // A zero count means the track does not exist.
    if (expected <= 0) continue
    const packets = packetBudget(expected)
    const compact = Math.ceil((2 / 3) * packets)
    bytes += 8 * compact + 4 * packets + 8 * compact + 12 * compact + 4 * packets + 8 * packets
  }
  return bytes
}

// Above this share of the file, a reserved index's unused space would visibly
// grow small exports, which are cheap to build in memory with an exact index.
const MAX_RESERVE_SHARE = 0.02

// Whether to stream an export to disk. Small MP4/MOV files stay in memory,
// where the index is written exactly instead of reserved.
export function shouldStream(estimatedBytes: number, packetCounts: PacketCounts | null): boolean {
  if (!packetCounts) return true
  return reservedIndexBytes(packetCounts) <= estimatedBytes * MAX_RESERVE_SHARE
}

// Whether a quota leaves room for an export of about `estimatedBytes`.
export function hasRoomFor(
  estimate: { quota?: number; usage?: number },
  estimatedBytes: number
): boolean {
  if (estimate.quota === undefined) return false
  const free = estimate.quota - (estimate.usage ?? 0)
  return free >= estimatedBytes * SIZE_SAFETY_FACTOR + QUOTA_HEADROOM_BYTES
}

// The only part of the sync access handle used here; the DOM typings used
// for this code leave it out (it exists only in dedicated workers).
type SyncAccessHandle = {
  write: (buffer: Uint8Array, options: { at: number }) => number
  flush: () => void
  close: () => void
}
type SyncFileHandle = FileSystemFileHandle & {
  createSyncAccessHandle?: () => Promise<SyncAccessHandle>
}

const EXTENSIONS: Record<MbContainer, string> = { mp4: 'mp4', mov: 'mov', mkv: 'mkv', webm: 'webm' }

function memoryTarget(): ExportTarget {
  const target = new BufferTarget()
  return {
    target,
    streaming: false,
    finish: async () => {
      if (!target.buffer) throw new Error('mediabunny output produced no buffer')
      return { kind: 'buffer', buffer: target.buffer }
    },
    discard: async () => {},
  }
}

async function streamingTarget(
  storageDir: string,
  container: MbContainer,
  onStorageFile: (storageName: string) => void
): Promise<ExportTarget | null> {
  const root = await navigator.storage.getDirectory()
  const exportsDir = await root.getDirectoryHandle(EXPORTS_DIR, { create: true })
  const tabDir = await exportsDir.getDirectoryHandle(storageDir, { create: true })
  const fileName = `export-${crypto.randomUUID()}.${EXTENSIONS[container]}`
  const fileHandle = (await tabDir.getFileHandle(fileName, { create: true })) as SyncFileHandle
  if (!fileHandle.createSyncAccessHandle) {
    await tabDir.removeEntry(fileName)
    return null
  }
  const access = await fileHandle.createSyncAccessHandle()
  const storageName = `${storageDir}/${fileName}`
  onStorageFile(storageName)
  let open = true
  const closeAccess = () => {
    if (!open) return
    open = false
    access.flush()
    access.close()
  }

  const writable = new WritableStream<StreamTargetChunk>({
    write(chunk) {
      const written = access.write(chunk.data, { at: chunk.position })
      if (written !== chunk.data.byteLength) {
        throw new Error('Ran out of storage space while writing the export')
      }
    },
    close: closeAccess,
    abort: closeAccess,
  })

  return {
    target: new StreamTarget(writable, { chunked: true, chunkSize: STREAM_CHUNK_BYTES }),
    streaming: true,
    finish: async () => {
      closeAccess()
      return { kind: 'file', file: await fileHandle.getFile(), storageName }
    },
    discard: async () => {
      closeAccess()
      await tabDir.removeEntry(fileName).catch(() => {})
    },
  }
}

// Stream the export into a file in the origin private file system, so memory
// stays flat however long the export runs and the 4 GiB ArrayBuffer ceiling no
// longer applies. Falls back to an in-memory buffer when that file system, its
// synchronous handles, or enough quota is missing.
export async function createExportTarget(options: {
  storageDir: string | undefined
  container: MbContainer
  estimatedBytes: number
  // The bounds a reserved MP4/MOV index would use; null for other containers
  // or when the index goes at the end.
  packetCounts: PacketCounts | null
  onStorageFile: (storageName: string) => void
}): Promise<ExportTarget> {
  const { storageDir, container, estimatedBytes, packetCounts, onStorageFile } = options
  if (!storageDir || typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return memoryTarget()
  }
  if (!shouldStream(estimatedBytes, packetCounts)) return memoryTarget()
  try {
    if (!hasRoomFor(await navigator.storage.estimate(), estimatedBytes)) return memoryTarget()
    return (await streamingTarget(storageDir, container, onStorageFile)) ?? memoryTarget()
  } catch {
    // Private windows and locked-down profiles can refuse storage outright.
    return memoryTarget()
  }
}

// mediabunny rejects a packet past the reserved index with this message.
export function isReserveOverflow(error: unknown): boolean {
  return error instanceof Error && /maximum packet count/i.test(error.message)
}

// Frames per encoded packet: AAC-LC always packs 1024; Opus at most 20 ms.
const AUDIO_PACKET_FRAMES: Record<MbAudioCodec, number> = { aac: 1024, opus: 960 }
// Priming and flush packets some encoders add.
const ENCODER_EXTRA_PACKETS = 4

// Audio packets for `durationSec` of output, plus one partial packet per join.
export function audioPacketBound(
  durationSec: number,
  sampleRate: number,
  codec: MbAudioCodec,
  joins: number
): number {
  const frames = Math.max(0, durationSec) * sampleRate
  return Math.ceil(frames / AUDIO_PACKET_FRAMES[codec]) + ENCODER_EXTRA_PACKETS + joins
}

// Run an encode with a reserved index, and if the packet bound still proves too
// small, run it again with the index at the end rather than fail the export.
export async function withReserveFallback<T>(
  packetCounts: PacketCounts | null,
  attempt: (packetCounts: PacketCounts | null) => Promise<T>,
  canceled: () => boolean
): Promise<T> {
  try {
    return await attempt(packetCounts)
  } catch (error) {
    if (!packetCounts || canceled() || !isReserveOverflow(error)) throw error
    return attempt(null)
  }
}

// The worker's done message for a result, with the buffer to transfer.
export function doneMessage(result: ExportResult): {
  message: { type: 'done'; file: File; storageName: string } | { type: 'done'; buffer: ArrayBuffer }
  transfer: Transferable[]
} {
  if (result.kind === 'file') {
    return {
      message: { type: 'done', file: result.file, storageName: result.storageName },
      transfer: [],
    }
  }
  return { message: { type: 'done', buffer: result.buffer }, transfer: [result.buffer] }
}
