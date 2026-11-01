import { describe, expect, it } from 'vitest'

import { createCoalescingHistory } from '@/lib/coalescingHistory'

function setup() {
  let clock = 0
  let generation = 0
  let records = 0
  const recordCoalesced = createCoalescingHistory({
    record: () => {
      records += 1
      generation += 1
    },
    generation: () => generation,
    windowMs: 500,
    now: () => clock,
  })
  return {
    recordCoalesced,
    advance: (ms: number) => (clock += ms),
    recordElsewhere: () => (generation += 1),
    records: () => records,
  }
}

describe('createCoalescingHistory', () => {
  it('records once for a burst of same-key edits within the window', () => {
    const history = setup()
    history.recordCoalesced('nudge')
    history.advance(200)
    history.recordCoalesced('nudge')
    history.advance(400)
    history.recordCoalesced('nudge')
    expect(history.records()).toBe(1)
  })

  it('starts a new entry after the window lapses', () => {
    const history = setup()
    history.recordCoalesced('nudge')
    history.advance(501)
    history.recordCoalesced('nudge')
    expect(history.records()).toBe(2)
  })

  it('starts a new entry for a different key', () => {
    const history = setup()
    history.recordCoalesced('nudge:a')
    history.recordCoalesced('nudge:b')
    expect(history.records()).toBe(2)
  })

  it('never folds into a burst after an unrelated history entry', () => {
    const history = setup()
    history.recordCoalesced('nudge')
    history.recordElsewhere()
    history.recordCoalesced('nudge')
    expect(history.records()).toBe(2)
  })
})
