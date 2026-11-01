import { EXPORTS_DIR } from '@/lib/webcodecs/protocol'

// Streamed exports are files in the origin private file system. Records of
// them live only in memory, so files outlive the tab that made them unless
// they are deleted: with the record, or by a later tab's startup sweep. Each
// tab writes under its own folder and holds a Web Lock named after it for its
// lifetime, so the sweep can tell a live tab's folder from an orphan.
const LOCK_PREFIX = 'splicer-exports:'
// Without Web Locks a folder only counts as orphaned once it is this old.
const UNLOCKED_ORPHAN_AGE_MS = 24 * 60 * 60 * 1000

let tabFolder: string | null = null

function hasStorage(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
}

// This tab's export folder name, claimed on first use. Undefined when the
// browser has no origin private file system (exports then stay in memory).
export function exportStorageDir(): string | undefined {
  if (!hasStorage()) return undefined
  if (!tabFolder) {
    tabFolder = crypto.randomUUID()
    // Held until the tab closes.
    void navigator.locks?.request(`${LOCK_PREFIX}${tabFolder}`, () => new Promise<never>(() => {}))
  }
  return tabFolder
}

async function exportsDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!hasStorage()) return null
  try {
    const root = await navigator.storage.getDirectory()
    return await root.getDirectoryHandle(EXPORTS_DIR, { create: true })
  } catch {
    return null
  }
}

// A worker terminated mid-write releases its file handle a moment later.
const DELETE_ATTEMPTS = 4
const DELETE_RETRY_MS = 250

// Delete one streamed export by the storage name its worker reported
// ("<tab folder>/<file>"). Missing files are fine: the work is already done.
export async function deleteStoredExport(storageName: string): Promise<void> {
  const [folder, fileName] = storageName.split('/')
  if (!folder || !fileName) return
  const exportsDir = await exportsDirectory()
  if (!exportsDir) return
  let tabDir: FileSystemDirectoryHandle
  try {
    tabDir = await exportsDir.getDirectoryHandle(folder)
  } catch {
    return
  }
  for (let attempt = 1; attempt <= DELETE_ATTEMPTS; attempt++) {
    try {
      await tabDir.removeEntry(fileName)
      return
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') return
      if (attempt === DELETE_ATTEMPTS) return
      await new Promise((resolve) => setTimeout(resolve, DELETE_RETRY_MS * attempt))
    }
  }
}

type FolderEntry = { name: string; handle: FileSystemDirectoryHandle }

// Whether no live tab owns `folder`: its lock is free, or, without Web Locks,
// nothing in it changed for a day.
async function isOrphaned(folder: FolderEntry, now: number): Promise<boolean> {
  if (navigator.locks) {
    return navigator.locks.request(
      `${LOCK_PREFIX}${folder.name}`,
      { ifAvailable: true },
      (lock) => lock !== null
    )
  }
  let newest = 0
  for await (const entry of folder.handle.values()) {
    if (entry.kind !== 'file') continue
    newest = Math.max(newest, (await (entry as FileSystemFileHandle).getFile()).lastModified)
  }
  return now - newest > UNLOCKED_ORPHAN_AGE_MS
}

// Remove exports left by tabs that closed or crashed. Returns how many folders
// were removed.
export async function sweepOrphanExports(now = Date.now()): Promise<number> {
  const exportsDir = await exportsDirectory()
  if (!exportsDir) return 0
  const folders: FolderEntry[] = []
  for await (const entry of exportsDir.values()) {
    if (entry.kind === 'directory' && entry.name !== tabFolder) {
      folders.push({ name: entry.name, handle: entry as FileSystemDirectoryHandle })
    } else if (entry.kind === 'file') {
      // Nothing writes loose files here.
      await exportsDir.removeEntry(entry.name).catch(() => {})
    }
  }
  let removed = 0
  for (const folder of folders) {
    try {
      if (!(await isOrphaned(folder, now))) continue
      await exportsDir.removeEntry(folder.name, { recursive: true })
      removed++
    } catch {
      // A file still open in another tab cannot be removed; try next time.
    }
  }
  return removed
}
