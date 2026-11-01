// Waveform math shared by the extraction worker and the timeline view. Peaks
// are max-abs amplitudes (0..1) in equal-length buckets over the whole clip.

export const PEAKS_PER_SECOND = 100
export const MIN_PEAK_COUNT = 2000
// One hour at 100 peaks/s; about 1.4 MB as a Float32Array.
export const MAX_PEAK_COUNT = 400_000

// Peak density follows the clip length, so a long clip still has a peak for
// every drawn bar at normal zoom levels.
export function waveformPeakCount(duration: number): number {
  if (!(duration > 0)) return MIN_PEAK_COUNT
  return Math.min(MAX_PEAK_COUNT, Math.max(MIN_PEAK_COUNT, Math.ceil(duration * PEAKS_PER_SECOND)))
}

// Fold one decoded chunk of interleaved samples into `peaks`. `startFrame` is
// the chunk's first frame on the clip's frame grid, and each bucket spans
// `framesPerBucket` frames. Frames are walked one bucket-run at a time, so the
// inner loop is a plain max with no per-sample division. Returns false once
// the chunk reaches past the last bucket, so the caller can stop decoding.
export function accumulatePeaks(
  peaks: Float32Array,
  samples: Float32Array,
  channelCount: number,
  frameCount: number,
  startFrame: number,
  framesPerBucket: number
): boolean {
  if (!(framesPerBucket > 0) || channelCount <= 0) return false
  let frame = 0
  while (frame < frameCount) {
    const bucket = Math.floor((startFrame + frame) / framesPerBucket)
    if (bucket >= peaks.length) return false
    const nextBucketFrame = Math.ceil((bucket + 1) * framesPerBucket) - startFrame
    // At least one frame per step, whatever the float rounding above says.
    const runEnd = Math.min(frameCount, Math.max(frame + 1, nextBucketFrame))
    if (bucket >= 0) {
      let peak = peaks[bucket]
      const end = runEnd * channelCount
      for (let i = frame * channelCount; i < end; i++) {
        const value = samples[i]
        const amplitude = value < 0 ? -value : value
        if (amplitude > peak) peak = amplitude
      }
      peaks[bucket] = peak
    }
    frame = runEnd
  }
  return true
}

// Heights (0..1) for `barCount` bars spanning the clip fraction
// [startRatio, endRatio). Each bar takes the max of every peak it covers, so
// no peak is skipped when zoomed out; when zoomed in past one peak per bar the
// value is interpolated between neighbouring peak centres, so no bar is empty.
export function computeBars(
  peaks: ArrayLike<number>,
  startRatio: number,
  endRatio: number,
  barCount: number
): Float32Array {
  const count = Math.max(0, Math.floor(barCount))
  const bars = new Float32Array(count)
  const total = peaks.length
  if (total === 0 || count === 0 || !(endRatio > startRatio)) return bars
  const firstPeak = Math.max(0, startRatio) * total
  const peaksPerBar = ((Math.min(1, endRatio) - Math.max(0, startRatio)) * total) / count
  if (!(peaksPerBar > 0)) return bars

  for (let bar = 0; bar < count; bar++) {
    const from = firstPeak + bar * peaksPerBar
    const to = from + peaksPerBar
    if (peaksPerBar >= 1) {
      const last = Math.min(total, Math.ceil(to))
      let peak = 0
      for (let i = Math.min(total - 1, Math.floor(from)); i < last; i++) {
        if (peaks[i] > peak) peak = peaks[i]
      }
      bars[bar] = peak
    } else {
      // Peak i is centred on i + 0.5.
      const position = Math.min(total - 1, Math.max(0, (from + to) / 2 - 0.5))
      const lower = Math.floor(position)
      const upper = Math.min(total - 1, lower + 1)
      const fraction = position - lower
      bars[bar] = peaks[lower] + (peaks[upper] - peaks[lower]) * fraction
    }
  }
  return bars
}

// The part of a block worth drawing, in block-local px: the scrolled-in view
// plus one chunk on each side, snapped to whole chunks so small scrolls reuse
// the canvas instead of redrawing it. Empty (from === to) when off screen.
export function visibleSpan(
  blockWidth: number,
  viewStart: number,
  viewWidth: number,
  chunkPx: number
): { from: number; to: number } {
  const from = Math.max(0, (Math.floor(viewStart / chunkPx) - 1) * chunkPx)
  const to = Math.min(blockWidth, (Math.ceil((viewStart + viewWidth) / chunkPx) + 1) * chunkPx)
  return to > from ? { from, to } : { from: 0, to: 0 }
}

// Runs async tasks one at a time, in order. A failed task does not stop the
// ones queued after it.
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task)
    tail = result.catch(() => {})
    return result
  }
}

export type WaveformRequest = { id: number; file: File; duration: number; peakCount: number }
export type WaveformResponse = { id: number; peaks: Float32Array }
