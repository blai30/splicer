import { describe, expect, it } from 'vitest'

import { createTrackPacer } from '@/lib/webcodecs/trackPacer'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => (resolve = done))
  return { promise, resolve }
}

describe('createTrackPacer', () => {
  it('schedules the track ahead of the video without waiting for it', async () => {
    const targets: number[] = []
    const gate = deferred()
    const pacer = createTrackPacer(
      async (untilSec) => {
        targets.push(untilSec)
        await gate.promise
      },
      { leadSec: 0.5, maxLagSec: 2 }
    )
    // Returns at once although the track has not caught up.
    await pacer.videoReached(0.1)
    await pacer.videoReached(0.2)
    expect(targets).toEqual([0.6])
    gate.resolve()
    await pacer.drain()
    expect(targets).toEqual([0.6, 0.7])
  })

  it('makes the video wait once the track lags too far', async () => {
    let finished = 0
    const gate = deferred()
    const pacer = createTrackPacer(
      async (untilSec) => {
        await gate.promise
        finished = untilSec
      },
      { leadSec: 0, maxLagSec: 1 }
    )
    await pacer.videoReached(0.5)
    let waited = false
    const late = pacer.videoReached(2).then(() => (waited = true))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(waited).toBe(false)
    gate.resolve()
    await late
    expect(finished).toBe(2)
  })

  it('surfaces a failure from the next wait and from drain', async () => {
    const pacer = createTrackPacer(
      async () => {
        throw new Error('audio failed')
      },
      { leadSec: 0, maxLagSec: 0.5 }
    )
    await pacer.videoReached(0.1)
    await expect(pacer.videoReached(5)).rejects.toThrow('audio failed')
    await expect(pacer.drain()).rejects.toThrow('audio failed')
  })
})
