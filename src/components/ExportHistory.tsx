import { exportHistory } from '../lib/store'
import type { ExportRecord } from '../lib/types'

function formatDuration(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function formatSize(bytes: number): string {
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
  if (exportHistory.value.length === 0) return null

  const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400'
  const td = 'px-3 py-2 text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap'

  return (
    <div class="flex flex-col rounded-lg bg-slate-100 dark:bg-slate-900 shrink-0 overflow-hidden">
      <div class="px-3 py-1.5 flex items-center gap-2.5 shrink-0 border-b border-slate-200 dark:border-slate-800">
        <span class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Exports
        </span>
        <button
          onClick={() => { exportHistory.value = [] }}
          class="ml-auto text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          Clear
        </button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse">
          <thead>
            <tr class="border-b border-slate-200 dark:border-slate-800">
              <th class={th}>File</th>
              <th class={th}>Duration</th>
              <th class={th}>Size</th>
              <th class={th}>FPS</th>
              <th class={th}>Dimensions</th>
            </tr>
          </thead>
          <tbody>
            {exportHistory.value.map((rec, i) => (
              <tr
                key={rec.id}
                class={i % 2 === 0 ? '' : 'bg-slate-50 dark:bg-slate-800/40'}
              >
                <td class={td}>
                  <a
                    href={rec.url}
                    download={rec.filename}
                    draggable
                    onDragStart={(e: DragEvent) => {
                      e.dataTransfer?.setData('DownloadURL', `${MIME_TYPES[rec.format]}:${rec.filename}:${rec.url}`)
                    }}
                    class="text-violet-500 hover:text-violet-400 underline underline-offset-2 cursor-pointer active:cursor-grabbing"
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
