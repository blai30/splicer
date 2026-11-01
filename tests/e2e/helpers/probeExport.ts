import type { Page } from '@playwright/test'
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny'

export type ExportProbe = {
  bytes: number
  videoPackets: number
  videoDurationSec: number
  audioDurationSec: number | null
  width: number
  height: number
}

// Read an exported object URL back from the page and demux it in Node, so
// tests can check frame counts and track durations without ffprobe.
export async function probeExport(page: Page, href: string): Promise<ExportProbe> {
  const bytes = await page.evaluate(async (url) => {
    const buffer = await (await fetch(url)).arrayBuffer()
    return Array.from(new Uint8Array(buffer))
  }, href)
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(new Uint8Array(bytes)) })
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
      width: video.displayWidth,
      height: video.displayHeight,
    }
  } finally {
    input.dispose()
  }
}
