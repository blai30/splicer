import { describe, expect, it, vi } from 'vitest'

import { consumeLaunchedFiles, filesFromLaunch, type LaunchParams } from '@/lib/launchQueue'

const handle = (file: File) => ({ kind: 'file', getFile: () => Promise.resolve(file) })

describe('filesFromLaunch', () => {
  it('reads every file handle, skipping directories and unreadable handles', async () => {
    const first = new File(['a'], 'first.mp4')
    const second = new File(['b'], 'second.webm')
    const files = await filesFromLaunch({
      files: [
        handle(first),
        { kind: 'directory', getFile: () => Promise.reject(new Error('not a file')) },
        { kind: 'file', getFile: () => Promise.reject(new Error('NotFoundError')) },
        handle(second),
      ],
    })
    expect(files).toEqual([first, second])
  })

  it('is empty for a launch without files', async () => {
    expect(await filesFromLaunch({})).toEqual([])
  })
})

describe('consumeLaunchedFiles', () => {
  it('does nothing without a launch queue', () => {
    expect(consumeLaunchedFiles({}, vi.fn())).toBe(false)
  })

  it('imports the launched files, and ignores launches without any', async () => {
    let consumer: ((params: LaunchParams) => void) | undefined
    const importLaunched = vi.fn()
    const attached = consumeLaunchedFiles(
      { launchQueue: { setConsumer: (next) => (consumer = next) } },
      importLaunched
    )
    expect(attached).toBe(true)

    consumer?.({ files: [] })
    const clip = new File(['x'], 'clip.mov')
    consumer?.({ files: [handle(clip)] })
    await vi.waitFor(() => expect(importLaunched).toHaveBeenCalledTimes(1))
    expect(importLaunched).toHaveBeenCalledWith([clip])
  })
})
