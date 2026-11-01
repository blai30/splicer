// Convert PCM of any rate/channel count to the export's fixed layout (stereo at
// the output rate). Encoders require constant audio parameters, so every source
// is normalized before it reaches the encoder.

// Mono is duplicated to both sides; stereo passes through; for more channels
// the front left/right pair is used.
export function toStereo(channels: Float32Array[]): [Float32Array, Float32Array] {
  if (channels.length === 0) return [new Float32Array(0), new Float32Array(0)]
  if (channels.length === 1) return [channels[0], channels[0]]
  return [channels[0], channels[1]]
}

// Streaming linear-interpolation resampler for one stereo stream. It keeps its
// fractional read position and the previous chunk's last frame between calls,
// so consecutive chunks resample as one continuous signal: no frames are
// dropped or duplicated at chunk boundaries.
export class StereoResampler {
  private readonly step: number
  // Read position of the next output frame, in input frames relative to the
  // start of the next chunk. -1 <= position means "between the previous
  // chunk's last frame and this chunk's first".
  private position = 0
  private previous: [number, number] | null = null

  constructor(inRate: number, outRate: number) {
    this.step = inRate / outRate
  }

  // Resample one chunk. Returns planar stereo (left plane, then right plane).
  process(left: Float32Array, right: Float32Array): { data: Float32Array; frames: number } {
    const inFrames = left.length
    if (inFrames === 0) return { data: new Float32Array(0), frames: 0 }
    if (this.step === 1 && this.previous === null && this.position === 0) {
      // Same rate: pass through untouched.
      const data = new Float32Array(inFrames * 2)
      data.set(left, 0)
      data.set(right, inFrames)
      return { data, frames: inFrames }
    }

    const prev = this.previous
    const sampleAt = (channel: Float32Array, index: number, side: 0 | 1): number =>
      index < 0 ? (prev ? prev[side] : channel[0]) : channel[index]

    const outLeft: number[] = []
    const outRight: number[] = []
    let position = this.position
    // Interpolating needs the frame after floor(position) inside this chunk.
    while (position < inFrames - 1) {
      const index = Math.floor(position)
      const fraction = position - index
      outLeft.push(
        sampleAt(left, index, 0) * (1 - fraction) + sampleAt(left, index + 1, 0) * fraction
      )
      outRight.push(
        sampleAt(right, index, 1) * (1 - fraction) + sampleAt(right, index + 1, 1) * fraction
      )
      position += this.step
    }
    // Carry the remainder into the next chunk, whose index -1 is our last frame.
    this.position = position - inFrames
    this.previous = [left[inFrames - 1], right[inFrames - 1]]

    const frames = outLeft.length
    const data = new Float32Array(frames * 2)
    data.set(outLeft, 0)
    data.set(outRight, frames)
    return { data, frames }
  }
}
