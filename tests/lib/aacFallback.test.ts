import { describe, expect, it, vi } from 'vitest'

import { ensureAacEncoder } from '@/lib/webcodecs/aacFallback'

describe('ensureAacEncoder', () => {
  it('loads and registers the WASM encoder only without native AAC', async () => {
    const registerAacEncoder = vi.fn()
    const loadEncoder = vi.fn(async () => ({ registerAacEncoder }))
    const registered = await ensureAacEncoder('aac', async () => false, loadEncoder)
    expect(registered).toBe(true)
    expect(loadEncoder).toHaveBeenCalledOnce()
    expect(registerAacEncoder).toHaveBeenCalledOnce()
  })

  it('skips the download when the browser encodes AAC natively', async () => {
    const loadEncoder = vi.fn(async () => ({ registerAacEncoder: vi.fn() }))
    expect(await ensureAacEncoder('aac', async () => true, loadEncoder)).toBe(false)
    expect(loadEncoder).not.toHaveBeenCalled()
  })

  it('never loads it for Opus output', async () => {
    const canEncode = vi.fn(async () => false)
    const loadEncoder = vi.fn(async () => ({ registerAacEncoder: vi.fn() }))
    expect(await ensureAacEncoder('opus', canEncode, loadEncoder)).toBe(false)
    expect(canEncode).not.toHaveBeenCalled()
    expect(loadEncoder).not.toHaveBeenCalled()
  })
})
