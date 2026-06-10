import { describe, expect, it } from 'vitest'

import { assessFeasibility } from '@/lib/exportFeasibility'

describe('assessFeasibility', () => {
  it('is green for a small mp4', () => {
    const result = assessFeasibility({
      width: 1280,
      height: 720,
      durationSec: 10,
      format: 'mp4',
      threads: null,
    })
    expect(result.band).toBe('green')
  })

  it('is red for a long 4k webm on single-thread', () => {
    const result = assessFeasibility({
      width: 3840,
      height: 2160,
      durationSec: 300,
      format: 'webm',
      threads: null,
    })
    expect(result.band).toBe('red')
    expect(result.reason).not.toBe('')
  })

  it('is more lenient for webm under multithread', () => {
    const single = assessFeasibility({
      width: 1920,
      height: 1080,
      durationSec: 60,
      format: 'webm',
      threads: null,
    })
    const multi = assessFeasibility({
      width: 1920,
      height: 1080,
      durationSec: 60,
      format: 'webm',
      threads: 8,
    })
    const order = { green: 0, yellow: 1, red: 2 }
    expect(order[multi.band]).toBeLessThanOrEqual(order[single.band])
  })
})
