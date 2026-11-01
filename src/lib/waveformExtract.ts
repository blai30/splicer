import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny'

import { accumulatePeaks } from './waveform'

// Stream-decode the audio track and fold it into `peakCount` max-abs buckets
// spread over `duration`. Memory stays bounded by one decoded chunk at a time,
// so arbitrarily long files are fine. Empty when there is no decodable audio.
export async function extractWaveformPeaks(
  file: File,
  duration: number,
  peakCount: number
): Promise<Float32Array> {
  if (!(duration > 0) || peakCount <= 0) return new Float32Array(0)
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track || !(await track.canDecode())) return new Float32Array(0)
    const peaks = new Float32Array(peakCount)
    const sink = new AudioSampleSink(track)
    let scratch = new Float32Array(0)
    for await (const sample of sink.samples()) {
      let more = true
      try {
        const channelCount = sample.numberOfChannels
        const frameCount = sample.numberOfFrames
        const length = frameCount * channelCount
        if (scratch.length < length) scratch = new Float32Array(length)
        // One interleaved copy for every channel instead of one per plane.
        sample.copyTo(scratch, { planeIndex: 0, format: 'f32' })
        const framesPerBucket = (sample.sampleRate * duration) / peakCount
        more = accumulatePeaks(
          peaks,
          scratch,
          channelCount,
          frameCount,
          Math.round(sample.timestamp * sample.sampleRate),
          framesPerBucket
        )
      } finally {
        sample.close()
      }
      // Audio running past the probed duration has no bucket to land in.
      if (!more) break
    }
    return peaks
  } catch {
    return new Float32Array(0)
  } finally {
    input.dispose()
  }
}
