import { describe, expect, it } from 'vitest'

import { nextRecoveryStep } from '@/lib/exportRecovery'

describe('nextRecoveryStep', () => {
  it('caps to 1280 on the first OOM (from original resolution)', () => {
    const step = nextRecoveryStep({ maxDimension: null })
    expect(step).not.toBeNull()
    expect(step!.maxDimension).toBe(1280)
  })

  it('steps down to 854 from 1280', () => {
    const step = nextRecoveryStep({ maxDimension: 1280 })
    expect(step!.maxDimension).toBe(854)
  })

  it('steps down to 640 from 854', () => {
    const step = nextRecoveryStep({ maxDimension: 854 })
    expect(step!.maxDimension).toBe(640)
  })

  it('gives up once the smallest cap has been tried', () => {
    const step = nextRecoveryStep({ maxDimension: 640 })
    expect(step).toBeNull()
  })
})
