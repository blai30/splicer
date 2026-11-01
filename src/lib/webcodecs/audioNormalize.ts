// Convert planar PCM of any rate/channel count to the export's fixed layout
// (stereo at the output rate). Encoders require constant audio parameters, so
// every source is normalized before it reaches the encoder.

export type PlanarAudio = {
  sampleRate: number
  // One Float32Array per channel, all the same length.
  channels: Float32Array[]
}

// Mono is duplicated to both sides; stereo passes through; for more channels
// the front left/right pair is used.
export function toStereo(channels: Float32Array[]): [Float32Array, Float32Array] {
  if (channels.length === 0) return [new Float32Array(0), new Float32Array(0)]
  if (channels.length === 1) return [channels[0], channels[0]]
  return [channels[0], channels[1]]
}

// Linear-interpolation resample of one channel to `outFrames` frames.
export function resampleChannel(
  input: Float32Array,
  ratio: number,
  outFrames: number
): Float32Array {
  const output = new Float32Array(outFrames)
  const last = input.length - 1
  if (last < 0) return output
  for (let frame = 0; frame < outFrames; frame++) {
    const position = frame * ratio
    const index = Math.min(last, Math.floor(position))
    const next = Math.min(last, index + 1)
    const fraction = position - index
    output[frame] = input[index] * (1 - fraction) + input[next] * fraction
  }
  return output
}

// Normalize to stereo at `outRate`, returned as one interleaved-by-plane
// buffer (left plane then right plane) ready for an f32-planar AudioSample.
export function normalizeAudio(
  audio: PlanarAudio,
  outRate: number
): { data: Float32Array; frames: number } {
  const [left, right] = toStereo(audio.channels)
  const inFrames = left.length
  if (inFrames === 0) return { data: new Float32Array(0), frames: 0 }
  if (audio.sampleRate === outRate) {
    const data = new Float32Array(inFrames * 2)
    data.set(left, 0)
    data.set(right, inFrames)
    return { data, frames: inFrames }
  }
  const ratio = audio.sampleRate / outRate
  const frames = Math.max(1, Math.round(inFrames / ratio))
  const data = new Float32Array(frames * 2)
  data.set(resampleChannel(left, ratio, frames), 0)
  data.set(resampleChannel(right, ratio, frames), frames)
  return { data, frames }
}
