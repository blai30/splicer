import type { Quality } from '@/lib/types'

export type RecoveryState = {
  quality: Quality
}

const QUALITY_LADDER: Quality[] = ['lossless', 'high', 'medium', 'low']

// Decide how to retry after an out-of-memory crash. Returns the next, cheaper
// settings to try, or null when there is nothing cheaper left.
export function nextRecoveryStep(state: RecoveryState, attempt: number): RecoveryState | null {
  const currentIndex = QUALITY_LADDER.indexOf(state.quality)
  const nextIndex = currentIndex + 1
  if (attempt >= QUALITY_LADDER.length - 1) return null
  if (nextIndex >= QUALITY_LADDER.length) return null
  return { quality: QUALITY_LADDER[nextIndex] }
}
