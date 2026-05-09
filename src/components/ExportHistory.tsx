import { Trash2 } from 'lucide-preact'

import { exportHistory } from '@/lib/store'
import type { ExportRecord } from '@/lib/types'

function formatDuration(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000_000) return `${(bytes / 1_000_000_000_000).toFixed(1)} TB`
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`
  return `${bytes} B`
}

function formatFps(fps: ExportRecord['fps']): string {
  return fps === 'original' ? 'Original' : `${fps} fps`
}

const MIME_TYPES: Record<ExportRecord['format'], string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
}

export function ExportHistory() {
  const isEmpty = exportHistory.value.length === 0

  if (isEmpty) return null

  const th =
    'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400'
  const td = 'px-4 py-3 text-sm text-slate-700 dark:text-slate-300 whitespace-nowrap'

  return (
    <div class="flex shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white/95 shadow-lg shadow-slate-900/10 backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/95 dark:shadow-black/30">
      <div class="flex shrink-0 items-center gap-2.5 px-4 pt-3 pb-2">
        <span class="text-xs font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
          Export Library
        </span>
        <button
          onClick={() => {
            exportHistory.value = []
          }}
          class="ml-auto flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
        >
          <Trash2 class="h-3 w-3" />
          Clear
        </button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse">
          <thead>
            <tr class="border-b border-slate-200 dark:border-slate-700/80">
              <th class={th}>File</th>
              <th class={th}>Duration</th>
              <th class={th}>Size</th>
              <th class={th}>FPS</th>
              <th class={th}>Dimensions</th>
            </tr>
          </thead>
          <tbody>
            {exportHistory.value.map((rec, i) => (
              <tr key={rec.id} class={i % 2 === 0 ? '' : 'bg-slate-50/80 dark:bg-slate-800/50'}>
                <td class={td}>
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
                    class="cursor-pointer text-violet-500 underline underline-offset-2 hover:text-violet-400 active:cursor-grabbing"
                    title="Click to download or drag to desktop"
                  >
                    {rec.filename}
                  </a>
                </td>
                <td class={td}>{formatDuration(rec.duration)}</td>
                <td class={td}>{formatSize(rec.size)}</td>
                <td class={td}>{formatFps(rec.fps)}</td>
                <td class={td}>{rec.width && rec.height ? `${rec.width}×${rec.height}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
