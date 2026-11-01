import { EtaTracker } from '@/lib/exportEta'
import { exportEtaSeconds, exporting, exportProgress } from '@/lib/store'
import type { WorkerResponse } from '@/lib/webcodecs/protocol'

export class ExportCanceledError extends Error {
  constructor() {
    super('Export canceled')
    this.name = 'ExportCanceledError'
  }
}

export type ExportOutput = { url: string; size: number }

type ActiveExport = { worker: Worker; settle: (error: Error) => void }

let active: ActiveExport | null = null

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

    exportProgress.value = 0
    exportEtaSeconds.value = null

    function finish(result: { output?: ExportOutput; error?: Error }) {
      if (settled) return
      settled = true
      worker.terminate()
      if (active?.worker === worker) active = null
      exporting.value = false
      exportEtaSeconds.value = null
      if (result.output) {
        exportProgress.value = 1
        resolve(result.output)
      } else {
        exportProgress.value = 0
        reject(result.error ?? new Error('Export failed'))
      }
    }

    active = { worker, settle: (error) => finish({ error }) }
    exporting.value = true

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      switch (message.type) {
        case 'progress': {
          const now = performance.now()
          exportProgress.value = message.progress
          eta.sample(message.progress, now)
          exportEtaSeconds.value = eta.etaSeconds(message.progress, now)
          break
        }
        case 'done': {
          const blob = new Blob([message.buffer], { type: mimeType })
          finish({ output: { url: URL.createObjectURL(blob), size: blob.size } })
          break
        }
        case 'canceled':
          finish({ error: new ExportCanceledError() })
          break
        case 'error':
          finish({ error: new Error(message.message) })
          break
      }
    }

    worker.onerror = (event) => {
      event.preventDefault()
      finish({ error: new Error(event.message || 'The export worker crashed') })
    }

    worker.postMessage({ type: 'export', job })
  })
}

// Stop the running export immediately. Its promise rejects with
// ExportCanceledError.
export function cancelExport(): void {
  if (!active) return
  const { worker, settle } = active
  worker.postMessage({ type: 'cancel' })
  settle(new ExportCanceledError())
}
