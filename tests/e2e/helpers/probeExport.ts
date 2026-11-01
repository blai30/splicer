import type { Page } from '@playwright/test'
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny'

export type ExportProbe = {
  bytes: number
  videoPackets: number
  videoDurationSec: number
  audioDurationSec: number | null
  width: number
  height: number
  // Top-level MP4/MOV box types in file order (empty for other containers).
  boxes: string[]
}

function topLevelBoxes(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const boxes: string[] = []
  let offset = 0
  while (offset + 8 <= bytes.length) {
    let size = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (!/^[\x20-\x7e]{4}$/.test(type)) return []
    if (size === 1) size = Number(view.getBigUint64(offset + 8))
    if (size === 0) size = bytes.length - offset
    if (size < 8) return boxes
    boxes.push(type)
    offset += size
  }
  return boxes
}

// Read an exported object URL back from the page and demux it in Node, so
// tests can check frame counts and track durations without ffprobe.
export async function probeExport(page: Page, href: string): Promise<ExportProbe> {
  const bytes = await page.evaluate(async (url) => {
    const buffer = await (await fetch(url)).arrayBuffer()
    return Array.from(new Uint8Array(buffer))
  }, href)
  const data = new Uint8Array(bytes)
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(data) })
  try {
    const video = await input.getPrimaryVideoTrack()
    if (!video) throw new Error('The export has no video track')
    const audio = await input.getPrimaryAudioTrack()
    const stats = await video.computePacketStats()
    return {
      bytes: bytes.length,
      videoPackets: stats.packetCount,
      videoDurationSec: await video.computeDuration(),
      audioDurationSec: audio ? await audio.computeDuration() : null,
      width: await video.getDisplayWidth(),
      height: await video.getDisplayHeight(),
      boxes: topLevelBoxes(data),
    }
  } finally {
    input.dispose()
  }
}
