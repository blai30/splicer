import clsx from 'clsx/lite'
import { Trash2 } from 'lucide-preact'

import { formatFps, formatSize, formatTime } from '@/lib/format'
import { exportHistory } from '@/lib/store'
import { MIME_TYPES } from '@/lib/types'

export function ExportHistory() {
  const isEmpty = exportHistory.value.length === 0

  if (isEmpty) return null

  return (
    <div class="flex shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200/60 bg-slate-50/40 backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/40">
      <div class="flex shrink-0 items-center gap-2.5 px-4 pt-3 pb-2">
        <span class="text-sm font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
          Export Library
        </span>
        <button
          onClick={() => {
            for (const record of exportHistory.value) {
              URL.revokeObjectURL(record.url)
            }
            exportHistory.value = []
          }}
          class="ml-auto flex items-center gap-1 text-sm text-slate-400 transition-colors hover:text-slate-600 hover:duration-0 dark:text-slate-500 dark:hover:text-slate-300"
        >
          <Trash2 class="h-3 w-3" />
          Clear
        </button>
      </div>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
