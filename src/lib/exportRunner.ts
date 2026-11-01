import { EtaTracker } from '@/lib/exportEta'
import { deleteStoredExport, exportStorageDir } from '@/lib/exportStorage'
import { exportEtaSeconds, exporting, exportProgress } from '@/lib/store'
import type { WorkerResponse } from '@/lib/webcodecs/protocol'

export class ExportCanceledError extends Error {
  constructor() {
    super('Export canceled')
    this.name = 'ExportCanceledError'
  }
}

// storageName is set when the file was streamed to the origin private file
// system and must be deleted with its record.
export type ExportOutput = { url: string; size: number; storageName?: string }

type ActiveExport = { worker: Worker; settle: (error: Error) => void }

let active: ActiveExport | null = null

// How long a canceled worker gets to stop and delete its partial file before
// it is terminated. Terminating it at once could kill it between creating the
// file and reporting its name, leaving a file nothing would delete.
export const CANCEL_GRACE_MS = 3000

export function isExportRunning(): boolean {
  return active !== null
}

// Run one export job in a freshly created worker. Progress and ETA flow into
// the shared export signals. The promise always settles: with the output, with
// the worker's error, or with ExportCanceledError after cancelExport().
export function runExportWorker(
  createWorker: () => Worker,
  job: unknown,
  mimeType: string
): Promise<ExportOutput> {
  if (active) return Promise.reject(new Error('Another export is already running'))

  return new Promise((resolve, reject) => {
    const worker = createWorker()
    const eta = new EtaTracker()
    let settled = false
    let stopped = false
    let delivered = false
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    // The streamed file the worker is writing, if any.
    let storageName: string | undefined

    exportProgress.value = 0
    exportEtaSeconds.value = null

    // Terminate the worker. Unless its file became the export's output, that
    // file is partial (or was finished after a cancel) and is deleted.
    function stopWorker() {
      if (stopped) return
      stopped = true
      clearTimeout(graceTimer)
      worker.terminate()
      if (!delivered && storageName) void deleteStoredExport(storageName)
    }

    function finish(result: { output?: ExportOutput; error?: Error }) {
      if (settled) return
      settled = true
      if (active?.worker === worker) active = null
      exporting.value = false
      exportEtaSeconds.value = null
      if (result.output) {
        exportProgress.value = 1
        delivered = true
        resolve(result.output)
      } else {
        exportProgress.value = 0
        reject(result.error ?? new Error('Export failed'))
      }
    }

    active = {
      worker,
      settle: (error) => {
        finish({ error })
        // The worker keeps running until it confirms the cancel or the grace
        // period ends, so its messages below still track the file it wrote.
        if (!stopped) graceTimer = setTimeout(stopWorker, CANCEL_GRACE_MS)
      },
    }
    exporting.value = true

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      switch (message.type) {
        case 'progress': {
          if (settled) break
          const now = performance.now()
          exportProgress.value = message.progress
          eta.sample(message.progress, now)
          exportEtaSeconds.value = eta.etaSeconds(message.progress, now)
          break
        }
        case 'storage':
          // A retry replaces the first attempt's file, which the worker deleted.
          storageName = message.storageName
          break
        case 'done': {
          storageName = 'file' in message ? message.storageName : undefined
          if (!settled) {
            // Wrapping the disk-backed file references it rather than copying it.
            const blob = new Blob(['file' in message ? message.file : message.buffer], {
              type: mimeType,
            })
            finish({ output: { url: URL.createObjectURL(blob), size: blob.size, storageName } })
          }
          stopWorker()
          break
        }
        case 'canceled':
          finish({ error: new ExportCanceledError() })
          stopWorker()
          break
        case 'error':
          finish({ error: new Error(message.message) })
          stopWorker()
          break
      }
    }

    worker.onerror = (event) => {
      event.preventDefault()
      finish({ error: new Error(event.message || 'The export worker crashed') })
      stopWorker()
    }

    worker.postMessage({ type: 'export', job, storageDir: exportStorageDir() })
  })
}

// Stop the running export. Its promise rejects with ExportCanceledError right
// away; the worker gets a moment to clean up before it is terminated.
export function cancelExport(): void {
  if (!active) return
  const { worker, settle } = active
  worker.postMessage({ type: 'cancel' })
  settle(new ExportCanceledError())
}
