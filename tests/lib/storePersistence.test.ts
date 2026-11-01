// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadStoreWith(key: string, raw: string) {
  localStorage.setItem(`splicer_state:${key}`, raw)
  vi.resetModules()
  return import('@/lib/store')
}

describe('persisted advancedSnapEnabled', () => {
  afterEach(() => localStorage.clear())

  it('defaults to on', async () => {
    vi.resetModules()
    const store = await import('@/lib/store')
    expect(store.advancedSnapEnabled.value).toBe(true)
  })

  it('restores a saved preference', async () => {
    const store = await loadStoreWith('advancedSnapEnabled', 'false')
    expect(store.advancedSnapEnabled.value).toBe(false)
  })

  it('falls back to on for an invalid stored value', async () => {
    const store = await loadStoreWith('advancedSnapEnabled', '"yes"')
    expect(store.advancedSnapEnabled.value).toBe(true)
  })
})
