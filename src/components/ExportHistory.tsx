import clsx from 'clsx/lite'
import { Trash2 } from 'lucide-preact'

import { formatFps, formatSize, formatTime } from '@/lib/format'
import { exportHistory } from '@/lib/store'
import type { ExportRecord } from '@/lib/types'

const MIME_TYPES: Record<ExportRecord['format'], string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
}

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
            for (const rec of exportHistory.value) {
              URL.revokeObjectURL(rec.url)
            }
            exportHistory.value = []
          }}
          class="ml-auto flex items-center gap-1 text-sm text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
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
            {exportHistory.value.map((rec, i) => (
              <tr key={rec.id} class={clsx(i % 2 !== 0 && 'bg-slate-50/80 dark:bg-slate-800/50')}>
                <td class="px-4 py-3 text-base whitespace-nowrap text-slate-700 dark:text-slate-300">
                  <a
                    href={rec.url}
                    download={rec.filename}
                    draggable
                    onDragStart={(e: DragEvent) => {
                      e.dataTransfer?.setData(
                        'DownloadURL',
                        `${MIME_TYPES[rec.format]}:${rec.filename}:${rec.url}`
                      )
                    }}
                    class="cursor-pointer text-violet-600 underline underline-offset-2 hover:text-violet-400 active:cursor-grabbing dark:text-violet-400 dark:hover:text-violet-300"
                    title="Click to download or drag to desktop"
                  >
                    {rec.filename}
                  </a>
                </td>
                <td class="px-4 py-3 text-base whitespace-nowrap text-slate-700 dark:text-slate-300">
                  {formatTime(rec.duration)}
                </td>
                <td class="px-4 py-3 text-base whitespace-nowrap text-slate-700 dark:text-slate-300">
                  {formatSize(rec.size)}
                </td>
                <td class="px-4 py-3 text-base whitespace-nowrap text-slate-700 dark:text-slate-300">
                  {formatFps(rec.fps)}
                </td>
                <td class="px-4 py-3 text-base whitespace-nowrap text-slate-700 dark:text-slate-300">
                  {rec.width && rec.height ? `${rec.width}×${rec.height}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
