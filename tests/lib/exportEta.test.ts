import { describe, expect, it } from 'vitest'

import { EtaTracker } from '@/lib/exportEta'

describe('EtaTracker', () => {
  it('estimates remaining seconds from steady progress', () => {
    const tracker = new EtaTracker()
    tracker.sample(0.0, 0)
    tracker.sample(0.25, 1000)
    tracker.sample(0.5, 2000)
    const eta = tracker.etaSeconds(0.5, 2000)
    // Half done in 2s implies roughly 2s remaining.
    expect(eta).toBeGreaterThan(1)
    expect(eta).toBeLessThan(4)
  })

  it('returns null before it has enough samples', () => {
    const tracker = new EtaTracker()
    tracker.sample(0.0, 0)
    expect(tracker.etaSeconds(0.0, 0)).toBeNull()
  })
})
