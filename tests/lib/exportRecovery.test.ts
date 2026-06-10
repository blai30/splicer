import { describe, expect, it } from 'vitest'

import { nextRecoveryStep } from '@/lib/exportRecovery'

describe('nextRecoveryStep', () => {
  it('drops quality on the first OOM', () => {
    const step = nextRecoveryStep({ quality: 'lossless' }, 0)
    expect(step).not.toBeNull()
    expect(step!.quality).toBe('high')
  })

  it('steps quality further down on the second OOM', () => {
    const step = nextRecoveryStep({ quality: 'high' }, 1)
    expect(step!.quality).toBe('medium')
  })

  it('gives up after the ladder is exhausted', () => {
    const step = nextRecoveryStep({ quality: 'low' }, 2)
    expect(step).toBeNull()
  })
})
