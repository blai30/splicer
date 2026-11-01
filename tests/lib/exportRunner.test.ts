import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkerResponse } from '@/lib/webcodecs/protocol'

const deleteStoredExport = vi.fn(async (_storageName: string) => {})
vi.mock('@/lib/exportStorage', () => ({
  deleteStoredExport: (storageName: string) => deleteStoredExport(storageName),
  exportStorageDir: () => 'tab',
}))

const { CANCEL_GRACE_MS, cancelExport, ExportCanceledError, isExportRunning, runExportWorker } =
  await import('@/lib/exportRunner')

// A stand-in worker the test drives by hand.
class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  posted: unknown[] = []
  terminated = false
  postMessage(message: unknown) {
    this.posted.push(message)
  }
  terminate() {
    this.terminated = true
  }
  emit(message: WorkerResponse) {
    this.onmessage?.({ data: message } as MessageEvent<WorkerResponse>)
  }
}

function start() {
  const worker = new FakeWorker()
  const result = runExportWorker(() => worker as unknown as Worker, {}, 'video/mp4')
  return { worker, result }
}

beforeEach(() => {
  vi.useFakeTimers()
  deleteStoredExport.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('cancelExport', () => {
  it('settles at once but lets the worker clean up before terminating it', async () => {
    const { worker, result } = start()
    cancelExport()
    await expect(result).rejects.toBeInstanceOf(ExportCanceledError)
    expect(isExportRunning()).toBe(false)
    expect(worker.posted).toContainEqual({ type: 'cancel' })
    expect(worker.terminated).toBe(false)

    worker.emit({ type: 'canceled' })
    expect(worker.terminated).toBe(true)
  })

  it('deletes a file the worker reports after the cancel', async () => {
    const { worker, result } = start()
    cancelExport()
    await expect(result).rejects.toBeInstanceOf(ExportCanceledError)
    worker.emit({ type: 'storage', storageName: 'tab/export-late.mp4' })
    vi.advanceTimersByTime(CANCEL_GRACE_MS)
    expect(worker.terminated).toBe(true)
    expect(deleteStoredExport).toHaveBeenCalledWith('tab/export-late.mp4')
  })

  it('deletes an export that finished just after the cancel', async () => {
    const { worker, result } = start()
    cancelExport()
    await expect(result).rejects.toBeInstanceOf(ExportCanceledError)
    const file = new File([], 'export-done.mp4')
    worker.emit({ type: 'done', file, storageName: 'tab/export-done.mp4' })
    expect(worker.terminated).toBe(true)
    expect(deleteStoredExport).toHaveBeenCalledWith('tab/export-done.mp4')
  })

  it('terminates a worker that never answers', async () => {
    const { worker, result } = start()
    cancelExport()
    await expect(result).rejects.toBeInstanceOf(ExportCanceledError)
    vi.advanceTimersByTime(CANCEL_GRACE_MS - 1)
    expect(worker.terminated).toBe(false)
    vi.advanceTimersByTime(1)
    expect(worker.terminated).toBe(true)
  })

  it('lets the next export start while the canceled worker winds down', async () => {
    const first = start()
    cancelExport()
    await expect(first.result).rejects.toBeInstanceOf(ExportCanceledError)
    const second = start()
    expect(isExportRunning()).toBe(true)
    second.worker.emit({ type: 'done', buffer: new ArrayBuffer(4) })
    await expect(second.result).resolves.toMatchObject({ size: 4 })
    first.worker.emit({ type: 'canceled' })
    expect(first.worker.terminated).toBe(true)
  })
})

describe('runExportWorker', () => {
  it('keeps a delivered file and terminates the worker', async () => {
    const { worker, result } = start()
    worker.emit({ type: 'storage', storageName: 'tab/export-a.mp4' })
    const file = new File([new Uint8Array(8)], 'export-a.mp4')
    worker.emit({ type: 'done', file, storageName: 'tab/export-a.mp4' })
    await expect(result).resolves.toMatchObject({ size: 8, storageName: 'tab/export-a.mp4' })
    expect(worker.terminated).toBe(true)
    expect(deleteStoredExport).not.toHaveBeenCalled()
  })

  it('deletes the partial file when the worker fails', async () => {
    const { worker, result } = start()
    worker.emit({ type: 'storage', storageName: 'tab/export-b.mp4' })
    worker.emit({ type: 'error', message: 'encoder broke', unsupported: false })
    await expect(result).rejects.toThrow('encoder broke')
    expect(worker.terminated).toBe(true)
    expect(deleteStoredExport).toHaveBeenCalledWith('tab/export-b.mp4')
  })
})
