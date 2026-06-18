import { beforeEach, describe, expect, it } from 'vitest'

import { clearOutputLock, setOutputLock } from '@/lib/advanced/advancedEditing'
import { advancedOutputLock } from '@/lib/store'

describe('advancedEditing output lock', () => {
  beforeEach(() => {
    advancedOutputLock.value = null
  })

  it('setOutputLock clamps to even integers within bounds', () => {
    setOutputLock(1281, 9999)
    expect(advancedOutputLock.value).toEqual({ width: 1280, height: 7680 })
  })

  it('clearOutputLock resets to Auto (null)', () => {
    setOutputLock(1280, 720)
    clearOutputLock()
    expect(advancedOutputLock.value).toBeNull()
  })
})
