// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ExportRecord } from '@/lib/types'

const deleted: string[] = []
vi.mock('@/lib/exportStorage', () => ({
  deleteStoredExport: async (storageName: string) => {
    deleted.push(storageName)
  },
}))

const store = await import('@/lib/store')

function record(id: string, size: number, storageName?: string): ExportRecord {
  return {
    id,
    filename: `${id}.mp4`,
    url: `blob:${id}`,
    size,
    duration: 1,
    fps: 'original',
    width: 320,
    height: 240,
    format: 'mp4',
    storageName,
  }
}

describe('recordsWithinLimits', () => {
  it('keeps the newest records within the count and byte limits', () => {
    const records = [record('c', 40), record('b', 40), record('a', 40)]
    expect(store.recordsWithinLimits(records, 10, 100).kept.map((entry) => entry.id)).toEqual([
      'c',
      'b',
    ])
    expect(store.recordsWithinLimits(records, 2, 1000).evicted.map((entry) => entry.id)).toEqual([
      'a',
    ])
    expect(store.recordsWithinLimits(records, 10, 1000).evicted).toEqual([])
  })

  it('always keeps the newest record, however large', () => {
    const { kept, evicted } = store.recordsWithinLimits(
      [record('big', 500), record('old', 1)],
      10,
      100
    )
    expect(kept.map((entry) => entry.id)).toEqual(['big'])
    expect(evicted.map((entry) => entry.id)).toEqual(['old'])
  })
})

describe('export library', () => {
  beforeEach(() => {
    deleted.length = 0
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    store.clearExportHistory()
  })
  afterEach(() => vi.restoreAllMocks())

  it('evicts the oldest past the byte cap, frees their files, and says so', () => {
    const half = store.EXPORT_LIBRARY_BYTE_LIMIT / 2
    store.addExportRecord(record('a', half, 'tab/a.mp4'))
    store.addExportRecord(record('b', half))
    expect(store.exportLibraryNotice.value).toBeNull()
    store.addExportRecord(record('c', half))
    expect(store.exportHistory.value.map((entry) => entry.id)).toEqual(['c', 'b'])
    expect(deleted).toEqual(['tab/a.mp4'])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:a')
    expect(store.exportLibraryNotice.value).toMatch(/Removed the oldest export/)
  })

  it('deletes a streamed file with its record and on clear', () => {
    store.addExportRecord(record('a', 1, 'tab/a.mp4'))
    store.addExportRecord(record('b', 1, 'tab/b.mp4'))
    store.removeExportRecord(store.exportHistory.value[1])
    expect(deleted).toEqual(['tab/a.mp4'])
    expect(store.exportHistory.value.map((entry) => entry.id)).toEqual(['b'])
    store.clearExportHistory()
    expect(deleted).toEqual(['tab/a.mp4', 'tab/b.mp4'])
    expect(store.exportHistory.value).toEqual([])
  })
})
