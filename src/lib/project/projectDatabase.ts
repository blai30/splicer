// IndexedDB storage for the autosaved project. Raw IndexedDB keeps this free of
// dependencies; the shape is two stores: the project record under one key,
// and each clip's source File under its clip id.

const DATABASE_NAME = 'splicer-project'
const DATABASE_VERSION = 1
const PROJECT_STORE = 'project'
const MEDIA_STORE = 'media'
const PROJECT_KEY = 'current'
// A database held open by an old tab can block the upgrade indefinitely.
const OPEN_TIMEOUT_MS = 5000

export type MediaWrite = { id: string; file: File }

export type ProjectStorage = {
  loadProject: () => Promise<unknown>
  // Clip ids whose files are stored.
  loadMediaIds: () => Promise<string[]>
  // The stored file for each id that has one and can still be read.
  loadMedia: (ids: readonly string[]) => Promise<Map<string, File>>
  // One transaction: either all of it lands or none does.
  saveProject: (
    record: unknown,
    media: readonly MediaWrite[],
    deleteMediaIds: readonly string[]
  ) => Promise<void>
  clear: () => Promise<void>
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    const fail = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onerror = fail
    transaction.onabort = fail
  })
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Opening storage timed out')), OPEN_TIMEOUT_MS)
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE)
      }
      if (!database.objectStoreNames.contains(MEDIA_STORE)) {
        database.createObjectStore(MEDIA_STORE)
      }
    }
    request.onsuccess = () => {
      clearTimeout(timer)
      const database = request.result
      // Let a newer version in another tab upgrade instead of waiting on us.
      database.onversionchange = () => database.close()
      resolve(database)
    }
    request.onerror = () => {
      clearTimeout(timer)
      reject(request.error ?? new Error('Could not open storage'))
    }
  })
}

// A stored File can outlive its bytes (evicted storage, a wiped profile).
// Reading one byte proves it is still there without loading the file.
async function readable(file: unknown): Promise<boolean> {
  if (!(file instanceof Blob)) return false
  try {
    await file.slice(0, 1).arrayBuffer()
    return true
  } catch {
    return false
  }
}

export function indexedDbProjectStorage(
  factory: IDBFactory | undefined = globalThis.indexedDB
): ProjectStorage | null {
  if (!factory) return null
  let database: Promise<IDBDatabase> | null = null
  const open = () => {
    database ??= openDatabase(factory).catch((err: unknown) => {
      database = null
      throw err
    })
    return database
  }

  return {
    async loadProject() {
      const store = (await open()).transaction(PROJECT_STORE).objectStore(PROJECT_STORE)
      return requestResult(store.get(PROJECT_KEY))
    },
    async loadMediaIds() {
      const store = (await open()).transaction(MEDIA_STORE).objectStore(MEDIA_STORE)
      const keys = await requestResult(store.getAllKeys())
      return keys.filter((key): key is string => typeof key === 'string')
    },
    async loadMedia(ids) {
      const store = (await open()).transaction(MEDIA_STORE).objectStore(MEDIA_STORE)
      const entries = await Promise.all(
        ids.map(async (id) => [id, await requestResult(store.get(id))] as const)
      )
      const files = new Map<string, File>()
      for (const [id, file] of entries) {
        if (await readable(file)) files.set(id, file as File)
      }
      return files
    },
    async saveProject(record, media, deleteMediaIds) {
      const transaction = (await open()).transaction([PROJECT_STORE, MEDIA_STORE], 'readwrite')
      const done = transactionDone(transaction)
      const mediaStore = transaction.objectStore(MEDIA_STORE)
      for (const id of deleteMediaIds) mediaStore.delete(id)
      for (const entry of media) mediaStore.put(entry.file, entry.id)
      transaction.objectStore(PROJECT_STORE).put(record, PROJECT_KEY)
      await done
    },
    async clear() {
      const transaction = (await open()).transaction([PROJECT_STORE, MEDIA_STORE], 'readwrite')
      const done = transactionDone(transaction)
      transaction.objectStore(PROJECT_STORE).clear()
      transaction.objectStore(MEDIA_STORE).clear()
      await done
    },
  }
}
