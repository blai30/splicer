import { AudioSample } from 'mediabunny'

import type { EditSlice } from './editPlan'
import type { SourceReader } from './mediabunnyInput'
import type { OutputHandle } from './mediabunnyOutput'

export type AudioEncodeOptions = {
  reader: SourceReader
  slice: EditSlice
  out: OutputHandle
  shouldCancel: () => boolean
}

// Encode one timeline slice's audio: read the slice's source time range, retime
// each sample onto the output timeline, and feed it to the mediabunny audio
// source. Muted slices emit silence of the same shape to keep A/V aligned.
export async function encodeAudioSlice(options: AudioEncodeOptions): Promise<void> {
  const { reader, slice, out, shouldCancel } = options
  if (!reader.audioSink || !out.audioSource) return

  const sliceStartUs = slice.sourceStart * 1_000_000

  for await (const sample of reader.audioSink.samples(slice.sourceStart, slice.sourceEnd)) {
    if (shouldCancel()) {
      sample.close()
      throw new Error('canceled')
    }

    if (sample.timestamp < slice.sourceStart || sample.timestamp >= slice.sourceEnd) {
      sample.close()
      continue
    }

    const outSec =
      (slice.outStartTimestampUs + (sample.microsecondTimestamp - sliceStartUs)) / 1_000_000

    if (slice.muted) {
      const silence = new Float32Array(sample.numberOfFrames * sample.numberOfChannels)
      const silentSample = new AudioSample({
        format: 'f32-planar',
        sampleRate: sample.sampleRate,
        numberOfChannels: sample.numberOfChannels,
        timestamp: outSec,
        data: silence,
      })
      sample.close()
      await out.audioSource.add(silentSample)
      silentSample.close()
      continue
    }

    sample.setTimestamp(outSec)
    await out.audioSource.add(sample)
    sample.close()
  }
}
