import { AlertTriangle, LoaderCircle, X } from 'lucide-preact'

import { importErrors, importing } from '@/lib/store'

// Import progress and failures. Failures stay until dismissed so a skipped file
// is never silent.
export function ImportStatus() {
  const errors = importErrors.value
  if (!importing.value && errors.length === 0) return null
  return (
    <div class="flex flex-col gap-2" aria-live="polite">
      {importing.value && (
        <div
          role="status"
          class="flex items-center gap-2 rounded-lg border border-slate-200/60 bg-slate-50/60 px-4 py-2 text-sm text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300"
        >
          <LoaderCircle class="size-4 animate-spin text-violet-500 motion-reduce:animate-none" />
          Importing video…
        </div>
      )}
      {errors.length > 0 && (
        <div
          role="alert"
          class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
        >
          <AlertTriangle class="mt-0.5 size-4 shrink-0" />
          <ul class="flex-1 space-y-1">
            {errors.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => (importErrors.value = [])}
            class="shrink-0 rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/50"
            aria-label="Dismiss import errors"
          >
            <X class="size-4" />
          </button>
        </div>
      )}
    </div>
  )
}
