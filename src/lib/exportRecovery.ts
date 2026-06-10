export type RecoveryState = {
  maxDimension: number | null
}

// An out-of-memory crash is driven by resolution (frame-buffer allocations in
// the bounded WASM heap), not by quality/CRF. Recovery therefore downscales the
// longest output side step by step until it fits, rather than lowering quality.
const DIMENSION_LADDER = [1280, 854, 640]

// Decide how to retry after an out-of-memory crash. Returns the next, smaller
// resolution cap to try, or null when there is nothing smaller left.
export function nextRecoveryStep(state: RecoveryState): RecoveryState | null {
  const current = state.maxDimension ?? Number.POSITIVE_INFINITY
  for (const cap of DIMENSION_LADDER) {
    if (cap < current) return { maxDimension: cap }
  }
  return null
}
