import { afterEach, describe, expect, it, vi } from 'vitest'

type FakeEntry = FakeDirectory | FakeFile
type FakeFile = { kind: 'file'; name: string; lastModified: number }

// Just enough of FileSystemDirectoryHandle for the storage helpers.
class FakeDirectory {
  readonly kind = 'directory'
  entries = new Map<string, FakeEntry>()
  constructor(readonly name: string) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    let entry = this.entries.get(name)
    if (!entry && options?.create) {
      entry = new FakeDirectory(name)
      this.entries.set(name, entry)
    }
    if (!entry || entry.kind !== 'directory') throw new DOMException('missing', 'NotFoundError')
    return entry
  }

  async removeEntry(name: string) {
    if (!this.entries.delete(name)) throw new DOMException('missing', 'NotFoundError')
  }

  async *values() {
    for (const entry of this.entries.values()) {
      yield entry.kind === 'file'
        ? { ...entry, getFile: async () => ({ lastModified: entry.lastModified }) }
        : entry
    }
  }

  addFile(name: string, lastModified = 0) {
    this.entries.set(name, { kind: 'file', name, lastModified })
  }
}

function setup(heldLocks: Set<string> | null) {
  const root = new FakeDirectory('')
  const exportsDir = new FakeDirectory('exports')
  root.entries.set('exports', exportsDir)
  const locks = heldLocks && {
    request: async (
      name: string,
      optionsOrCallback: unknown,
      maybeCallback?: (lock: object | null) => unknown
    ) => {
      if (typeof optionsOrCallback === 'function') {
        heldLocks.add(name)
        return new Promise(() => {})
      }
      return maybeCallback!(heldLocks.has(name) ? null : { name })
    },
  }
  vi.stubGlobal('navigator', {
    storage: { getDirectory: async () => root },
    locks: locks ?? undefined,
  })
  return { exportsDir }
}

async function loadStorage() {
  vi.resetModules()
  return import('@/lib/exportStorage')
}

describe('export storage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('claims one folder per tab and holds its lock', async () => {
    const held = new Set<string>()
    setup(held)
    const storage = await loadStorage()
    const folder = storage.exportStorageDir()
    expect(folder).toBeTruthy()
    expect(storage.exportStorageDir()).toBe(folder)
    expect(held).toEqual(new Set([`splicer-exports:${folder}`]))
  })

  it('sweeps folders whose tab is gone and keeps live ones', async () => {
    const held = new Set(['splicer-exports:live'])
    const { exportsDir } = setup(held)
    const storage = await loadStorage()
    const mine = storage.exportStorageDir()!
    for (const name of ['live', 'gone', mine]) {
      ;(await exportsDir.getDirectoryHandle(name, { create: true })).addFile('export-1.mp4')
    }
    exportsDir.addFile('stray.bin')

    expect(await storage.sweepOrphanExports()).toBe(1)
    expect([...exportsDir.entries.keys()].sort()).toEqual(['live', mine].sort())
  })

  it('without Web Locks, sweeps only folders untouched for a day', async () => {
    const { exportsDir } = setup(null)
    const storage = await loadStorage()
    const now = 10 * 24 * 60 * 60 * 1000
    ;(await exportsDir.getDirectoryHandle('old', { create: true })).addFile('a.mp4', 0)
    ;(await exportsDir.getDirectoryHandle('recent', { create: true })).addFile('b.mp4', now - 1000)
    expect(await storage.sweepOrphanExports(now)).toBe(1)
    expect([...exportsDir.entries.keys()]).toEqual(['recent'])
  })

  it('deletes one stored export and ignores missing ones', async () => {
    const { exportsDir } = setup(new Set())
    const storage = await loadStorage()
    const tab = await exportsDir.getDirectoryHandle('tab', { create: true })
    tab.addFile('x.mp4')
    await storage.deleteStoredExport('tab/x.mp4')
    expect(tab.entries.size).toBe(0)
    await storage.deleteStoredExport('tab/x.mp4')
    await storage.deleteStoredExport('nope/y.mp4')
    await storage.deleteStoredExport('malformed')
  })

  it('reports no folder without an origin private file system', async () => {
    vi.stubGlobal('navigator', {})
    const storage = await loadStorage()
    expect(storage.exportStorageDir()).toBeUndefined()
    expect(await storage.sweepOrphanExports()).toBe(0)
  })
})
