import clsx from 'clsx/lite'
import { Info, Trash2, X } from 'lucide-preact'
import { useEffect } from 'preact/hooks'

import { sweepOrphanExports } from '@/lib/exportStorage'
import { formatFps, formatSize, formatTime } from '@/lib/format'
import { info } from '@/lib/logger'
import {
  clearExportHistory,
  exportHistory,
  exportLibraryNotice,
  removeExportRecord,
} from '@/lib/store'
import { MIME_TYPES } from '@/lib/types'

export function ExportHistory() {
  // Exports streamed to disk by tabs that have since closed have no record
  // anywhere; reclaim their space once per page load.
  useEffect(() => {
    void sweepOrphanExports().then((removed) => {
      if (removed > 0) info('Removed exports left by closed tabs', { folders: removed })
    })
  }, [])

  const isEmpty = exportHistory.value.length === 0

  if (isEmpty) return null

  return (
    <div class="flex shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200/60 bg-slate-50/40 backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/40">
      <div class="flex shrink-0 items-center gap-2.5 px-4 pt-3 pb-2">
        <h2 class="text-sm font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
          Export library
        </h2>
        <button
          type="button"
          title="Remove all exports from this session"
          onClick={clearExportHistory}
          class="ml-auto flex items-center gap-1 text-sm text-slate-400 transition-colors hover:text-slate-600 hover:duration-0 dark:text-slate-500 dark:hover:text-slate-300"
        >
          <Trash2 class="h-3 w-3" />
          Clear
        </button>
      </div>
      {exportLibraryNotice.value && (
        <div
          role="status"
          class="mx-4 mb-2 flex items-start gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
        >
          <Info class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p class="flex-1">{exportLibraryNotice.value}</p>
          <button
            type="button"
            onClick={() => (exportLibraryNotice.value = null)}
            class="inline-flex size-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-amber-100 hover:duration-0 dark:hover:bg-amber-900/60"
            aria-label="Dismiss notice"
          >
            <X class="size-4" />
          </button>
        </div>
      )}
      <div class="overflow-x-auto">
        <table class="w-full border-collapse">
          <thead>
            <tr class="border-b border-slate-200/60 dark:border-slate-700/60">
              <th class="px-4 py-2 text-left text-sm font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
                File
              </th>
              <th class="px-4 py-2 text-left text-sm font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
                Duration
              </th>
              <th class="px-4 py-2 text-left text-sm font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
                Size
              </th>
              <th class="px-4 py-2 text-left text-sm font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
                FPS
              </th>
              <th class="px-4 py-2 text-left text-sm font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
                Dimensions
              </th>
              <th class="px-4 py-2">
                <span class="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {exportHistory.value.map((record, i) => (
              <tr
                key={record.id}
                class={clsx(i % 2 !== 0 && 'bg-slate-50/80 dark:bg-slate-800/50')}
              >
                <td class="px-4 py-3 text-base whitespace-nowrap text-slate-700 dark:text-slate-300">
                  <a
                    href={record.url}
                    download={record.filename}
                    draggable
                    onDragStart={(event: DragEvent) => {
                      event.dataTransfer?.setData(
                        'DownloadURL',
                        `${MIME_TYPES[record.format]}:${record.filename}:${record.url}`
                      )
                    }}
                    class="cursor-pointer text-violet-600 underline underline-offset-2 hover:text-violet-400 active:cursor-grabbing dark:text-violet-400 dark:hover:text-violet-300"
                    title="Click to download or drag to desktop"
                  >
                    {record.filename}
                  </a>
                </td>
                <td class="px-4 py-3 text-base whitespace-nowrap text-slate-700 dark:text-slate-300">
                  {formatTime(record.duration)}
                </td>
                <td class="px-4 py-3 text-base whitespace-nowrap text-slate-700 dark:text-slate-300">
                  {formatSize(record.size)}
                </td>
                <td class="px-4 py-3 text-base whitespace-nowrap text-slate-700 dark:text-slate-300">
                  {formatFps(record.fps)}
                </td>
                <td class="px-4 py-3 text-base whitespace-nowrap text-slate-700 dark:text-slate-300">
                  {record.width && record.height ? `${record.width}×${record.height}` : '–'}
                </td>
                <td class="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => removeExportRecord(record)}
                    class="inline-flex size-7 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700 hover:duration-0 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                    aria-label={`Remove ${record.filename}`}
                    title="Remove from library"
                  >
                    <X class="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
