import { describe, expect, it } from 'vitest'

import { AudioSliceWriter, encodeAudioSlice } from '@/lib/webcodecs/audioEncode'
import { createMixBuffer, mixLayer, WindowedMixer } from '@/lib/webcodecs/compositorAudioMix'
import type { CompositorAudioLayer } from '@/lib/webcodecs/compositorProtocol'
import type { EditSlice } from '@/lib/webcodecs/editPlan'
import type { SourceReader } from '@/lib/webcodecs/mediabunnyInput'
import { OUTPUT_SAMPLE_RATE, type OutputHandle } from '@/lib/webcodecs/mediabunnyOutput'

type FakeChunk = { timestamp: number; sampleRate: number; channels: Float32Array[] }

// Deterministic, distinct per-source signal.
function tone(seed: number, frames: number, offset = 0): Float32Array {
  const plane = new Float32Array(frames)
  for (let i = 0; i < frames; i++) plane[i] = Math.sin((i + offset) * 0.01 * seed) * 0.5
  return plane
}

// Chunked source audio, optionally with a hole of `gapSec` at `gapAtSec`.
function chunks(options: {
  seed: number
  durationSec: number
  sampleRate: number
  channelCount: number
  chunkFrames: number
  gap?: { atSec: number; lengthSec: number }
}): FakeChunk[] {
  const { seed, durationSec, sampleRate, channelCount, chunkFrames, gap } = options
  const result: FakeChunk[] = []
  const totalFrames = Math.round(durationSec * sampleRate)
  for (let start = 0; start < totalFrames; start += chunkFrames) {
    const timestamp = start / sampleRate
    if (gap && timestamp >= gap.atSec && timestamp < gap.atSec + gap.lengthSec) continue
    const frames = Math.min(chunkFrames, totalFrames - start)
    const channels = Array.from({ length: channelCount }, (_, channel) =>
      tone(seed + channel, frames, start)
    )
    result.push({ timestamp, sampleRate, channels })
  }
  return result
}

type ReaderLog = { opened: number; disposed: number }

function fakeReader(source: FakeChunk[], log: ReaderLog = { opened: 0, disposed: 0 }) {
  log.opened++
  const audioSink = {
    async *samples(start: number, end: number) {
      for (const chunk of source) {
        const frames = chunk.channels[0].length
        if (chunk.timestamp + frames / chunk.sampleRate <= start || chunk.timestamp >= end) continue
        yield {
          timestamp: chunk.timestamp,
          sampleRate: chunk.sampleRate,
          numberOfFrames: frames,
          numberOfChannels: chunk.channels.length,
          copyTo(
            destination: Float32Array,
            copy: { planeIndex: number; frameOffset: number; frameCount: number }
          ) {
            destination.set(
              chunk.channels[copy.planeIndex].subarray(
                copy.frameOffset,
                copy.frameOffset + copy.frameCount
              )
            )
          },
          close() {},
        }
      }
    },
  }
  return {
    videoSink: null,
    audioSink,
    dispose: () => log.disposed++,
  } as unknown as SourceReader
}

type Written = { timestamp: number; left: number[]; right: number[] }

function captureOutput() {
  const written: Written[] = []
  const out = {
    audioSource: {
      async add(sample: {
        timestamp: number
        numberOfFrames: number
        copyTo: (destination: Float32Array, options: object) => void
      }) {
        const left = new Float32Array(sample.numberOfFrames)
        const right = new Float32Array(sample.numberOfFrames)
        sample.copyTo(left, { planeIndex: 0, format: 'f32-planar' })
        sample.copyTo(right, { planeIndex: 1, format: 'f32-planar' })
        written.push({ timestamp: sample.timestamp, left: [...left], right: [...right] })
      },
    },
  } as unknown as OutputHandle
  return { out, written }
}

function flatten(written: Written[]) {
  return {
    left: written.flatMap((entry) => entry.left),
    right: written.flatMap((entry) => entry.right),
  }
}

const neverCancel = () => false

function slice(overrides: Partial<EditSlice> = {}): EditSlice {
  return {
    sourceIndex: 0,
    sourceStart: 0.25,
    sourceEnd: 1.75,
    muted: false,
    outStartTimestampUs: 0,
    ...overrides,
  }
}

describe('AudioSliceWriter', () => {
  const sources: Record<string, FakeChunk[]> = {
    '48 kHz stereo': chunks({
      seed: 1,
      durationSec: 2,
      sampleRate: 48_000,
      channelCount: 2,
      chunkFrames: 1024,
    }),
    '44.1 kHz mono with a hole': chunks({
      seed: 3,
      durationSec: 2,
      sampleRate: 44_100,
      channelCount: 1,
      chunkFrames: 1024,
      gap: { atSec: 0.8, lengthSec: 0.2 },
    }),
  }

  for (const [name, source] of Object.entries(sources)) {
    it(`writes the same audio in steps as in one pass (${name})`, async () => {
      const oneShot = captureOutput()
      const startFrame = 4800
      const endFrame = await encodeAudioSlice({
        reader: fakeReader(source),
        slice: slice(),
        out: oneShot.out,
        startFrame,
        shouldCancel: neverCancel,
      })

      const stepped = captureOutput()
      const writer = new AudioSliceWriter({
        reader: fakeReader(source),
        slice: slice(),
        out: stepped.out,
        startFrame,
        shouldCancel: neverCancel,
      })
      for (let step = startFrame; step < endFrame; step += 1500) {
        await writer.advanceTo(step)
        expect(writer.frame).toBeGreaterThanOrEqual(Math.min(step, endFrame))
      }
      expect(await writer.finish()).toBe(endFrame)

      expect(flatten(stepped.written)).toEqual(flatten(oneShot.written))
      expect(stepped.written.map((entry) => entry.timestamp)).toEqual(
        oneShot.written.map((entry) => entry.timestamp)
      )
      expect(flatten(stepped.written).left).toHaveLength(endFrame - startFrame)
    })
  }

  it('fills a muted slice with silence as it advances', async () => {
    const { out, written } = captureOutput()
    const writer = new AudioSliceWriter({
      reader: fakeReader(sources['48 kHz stereo']),
      slice: slice({ muted: true }),
      out,
      startFrame: 0,
      shouldCancel: neverCancel,
    })
    await writer.advanceTo(10_000)
    expect(writer.frame).toBe(10_000)
    await writer.finish()
    const samples = flatten(written).left
    expect(samples).toHaveLength(Math.round(1.5 * OUTPUT_SAMPLE_RATE))
    expect(samples.every((value) => value === 0)).toBe(true)
  })
})

describe('WindowedMixer', () => {
  const sourceA = chunks({
    seed: 1,
    durationSec: 3,
    sampleRate: 48_000,
    channelCount: 2,
    chunkFrames: 1024,
  })
  const sourceB = chunks({
    seed: 2,
    durationSec: 3,
    sampleRate: 44_100,
    channelCount: 1,
    chunkFrames: 960,
    gap: { atSec: 1.2, lengthSec: 0.3 },
  })
  const layers: { layer: CompositorAudioLayer; source: FakeChunk[] }[] = [
    {
      layer: { sourceIndex: 0, sourceStart: 0.1, sourceEnd: 2.6, timelineStart: 0, volume: 1 },
      source: sourceA,
    },
    // Overlaps the first, starts mid-window, and has a hole.
    {
      layer: { sourceIndex: 1, sourceStart: 0.5, sourceEnd: 2.9, timelineStart: 1.3, volume: 0.6 },
      source: sourceB,
    },
    // Starts after the first has ended, louder than unity.
    {
      layer: { sourceIndex: 0, sourceStart: 2, sourceEnd: 2.5, timelineStart: 3.2, volume: 1.5 },
      source: sourceA,
    },
  ]
  const durationSec = 3.9

  async function oneShotMix() {
    const mix = createMixBuffer(durationSec)
    for (const { layer, source } of layers) {
      await mixLayer(mix, layer, fakeReader(source), 'clip', neverCancel)
    }
    return mix
  }

  for (const windowFrames of [OUTPUT_SAMPLE_RATE, 4096, 777]) {
    it(`matches a one-shot mix in ${windowFrames}-frame windows`, async () => {
      const expected = await oneShotMix()
      const totalFrames = expected.left.length
      const mixer = new WindowedMixer(
        layers.map(({ layer, source }) => ({
          layer,
          fileName: 'clip',
          open: async () => fakeReader(source),
        })),
        neverCancel
      )
      const left = new Float32Array(totalFrames)
      const right = new Float32Array(totalFrames)
      for (let start = 0; start < totalFrames; start += windowFrames) {
        const end = Math.min(totalFrames, start + windowFrames)
        const window = await mixer.mixWindow(start, end)
        expect(window.left).toHaveLength(end - start)
        left.set(window.left, start)
        right.set(window.right, start)
      }
      await mixer.dispose()
      expect(left).toEqual(expected.left)
      expect(right).toEqual(expected.right)
    })
  }

  it('opens each layer when it starts and releases it when it ends', async () => {
    const logs = layers.map(() => ({ opened: 0, disposed: 0 }))
    const mixer = new WindowedMixer(
      layers.map(({ layer, source }, index) => ({
        layer,
        fileName: 'clip',
        open: async () => fakeReader(source, logs[index]),
      })),
      neverCancel
    )
    await mixer.mixWindow(0, OUTPUT_SAMPLE_RATE)
    expect(logs.map((log) => log.opened)).toEqual([1, 0, 0])
    await mixer.mixWindow(OUTPUT_SAMPLE_RATE, 2 * OUTPUT_SAMPLE_RATE)
    expect(logs.map((log) => log.opened)).toEqual([1, 1, 0])
    await mixer.mixWindow(2 * OUTPUT_SAMPLE_RATE, 3 * OUTPUT_SAMPLE_RATE)
    // The first layer ended at 2.5 s.
    expect(logs[0].disposed).toBe(1)
    await mixer.mixWindow(3 * OUTPUT_SAMPLE_RATE, 3.9 * OUTPUT_SAMPLE_RATE)
    expect(logs.map((log) => log.opened)).toEqual([1, 1, 1])
    await mixer.dispose()
    expect(logs.map((log) => log.disposed)).toEqual([1, 1, 1])
  })
})
