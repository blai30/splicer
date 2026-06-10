import type { ExportFormat } from '@/lib/types'

export type FeasibilityBand = 'green' | 'yellow' | 'red'

export type Feasibility = {
  band: FeasibilityBand
  reason: string
}

export type FeasibilityInput = {
  width: number
  height: number
  durationSec: number
  format: ExportFormat
  threads: number | null
}

// Relative encode cost weight per container. VP9/WebM is weighted heaviest
// because it dominates the in-browser hang/OOM failures.
const FORMAT_WEIGHT: Record<ExportFormat, number> = {
  mp4: 1,
  mkv: 1,
  mov: 1,
  webm: 4,
}

// Megapixel-seconds is a simple proxy for total encode work.
function workUnits(input: FeasibilityInput): number {
  const megapixels = (input.width * input.height) / 1_000_000
  return megapixels * input.durationSec * FORMAT_WEIGHT[input.format]
}

export function assessFeasibility(input: FeasibilityInput): Feasibility {
  const base = workUnits(input)
  // Multi-threading raises the threshold before a run is considered risky.
  const threadRelief = input.threads && input.threads > 1 ? input.threads / 2 : 1
  const adjusted = base / threadRelief

  // Thresholds are tunable; calibrated for in-browser WASM encoding.
  const yellowAt = 150
  const redAt = 600

  if (adjusted >= redAt) {
    return {
      band: 'red',
      reason:
        input.format === 'webm'
          ? 'Large WebM (VP9) export likely to run out of memory in the browser. Try a lower resolution, a faster preset, VP8, or a different format.'
          : 'Very large export likely to be slow or fail. Try a lower resolution or shorter selection.',
    }
  }
  if (adjusted >= yellowAt) {
    return {
      band: 'yellow',
      reason:
        input.format === 'webm'
          ? 'Large WebM export - this may take several minutes.'
          : 'Large export - this may take a while.',
    }
  }
  return { band: 'green', reason: '' }
}
