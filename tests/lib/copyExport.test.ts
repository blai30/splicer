import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildPacketIndex, type PacketIndex } from '@/lib/fastCopy'

const readPacketIndex = vi.fn<(file: Blob) => Promise<PacketIndex>>()
vi.mock('@/lib/packetIndex', () => ({ readPacketIndex: (file: Blob) => readPacketIndex(file) }))

const { copyPreview, packetIndexes } = await import('@/lib/copyExport')
const { appMode, clips, exportFormat, framerate, quality, resolution, timeline } =
  await import('@/lib/store')
const { appendClipToTimeline } = await import('@/lib/timelineEditing')

const clip = {
  id: 'a',
  file: new File([new Uint8Array([0])], 'a.mp4'),
  name: 'a',
  duration: 4,
  width: 320,
  height: 240,
  objectUrl: 'blob:a',
  waveformPeaks: new Float32Array(0),
  videoCodec: 'avc',
  decoderConfigKey: 'avc1.64001f|320x240|a',
  rotation: 0,
  squarePixels: true,
}

// One key frame a second, 30 fps.
function gopIndex(): PacketIndex {
  return buildPacketIndex(
    Array.from({ length: 120 }, (_, i) => ({
      timestamp: i / 30,
      duration: 1 / 30,
      isKey: i % 30 === 0,
      byteLength: 1000,
      sequenceNumber: i,
    }))
  )
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  readPacketIndex.mockReset()
  packetIndexes.value = new Map()
  appMode.value = 'basic'
  exportFormat.value = 'mp4'
  framerate.value = 'original'
  resolution.value = 'original'
  quality.value = 'high'
  clips.value = []
  timeline.value = []
  appendClipToTimeline(clip)
})

describe('copyPreview', () => {
  it('reports the copied bytes once the key frames are read', async () => {
    readPacketIndex.mockResolvedValue(gopIndex())
    quality.value = 'original'
    expect(copyPreview.value).toEqual({ status: 'loading' })
    await settle()
    expect(copyPreview.value).toMatchObject({ status: 'ready', videoBytes: 120_000 })
  })

  it('retries a failed read on the next change instead of keeping the failure', async () => {
    readPacketIndex.mockRejectedValueOnce(new Error('read error'))
    quality.value = 'original'
    await settle()
    expect(copyPreview.value).toEqual({ status: 'failed' })
    expect(readPacketIndex).toHaveBeenCalledTimes(1)

    readPacketIndex.mockResolvedValue(gopIndex())
    quality.value = 'high'
    quality.value = 'original'
    await settle()
    expect(readPacketIndex).toHaveBeenCalledTimes(2)
    expect(copyPreview.value).toMatchObject({ status: 'ready' })
  })

  it('stays copyable when the resolution cap is above the source size', async () => {
    readPacketIndex.mockResolvedValue(gopIndex())
    resolution.value = '720'
    quality.value = 'original'
    await settle()
    expect(copyPreview.value).toMatchObject({ status: 'ready' })
  })
})
