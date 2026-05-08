import { useSignal } from '@preact/signals'
import { exportFormat, exportUrl, ffmpegProgress, ffmpegReady, timeline } from '../lib/store'
import type { ExportFormat } from '../lib/types'
import { exportVideo, getFFmpeg } from '../lib/ffmpeg'

export function ExportPanel() {
  const exporting = useSignal(false)
  const error = useSignal<string | null>(null)

  async function initFFmpeg() {
    if (ffmpegReady.value) return
    await getFFmpeg()
  }

  async function handleExport() {
    if (timeline.value.length === 0) return
    exporting.value = true
    error.value = null
    exportUrl.value = null
    try {
      const url = await exportVideo(timeline.value, exportFormat.value)
      exportUrl.value = url
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Export failed'
    } finally {
      exporting.value = false
    }
  }

  const formats: ExportFormat[] = ['mp4', 'webm', 'mkv']
  const hasSegments = timeline.value.length > 0

  return (
    <div class="flex items-center gap-3 px-4 py-2 bg-mist-100 dark:bg-mist-800 border-t border-mist-200 dark:border-mist-700 shrink-0">
      {/* Format picker */}
      <div class="flex items-center gap-1.5">
        <span class="text-xs text-mist-500 dark:text-mist-400">Format:</span>
        {formats.map((f) => (
          <button
            key={f}
            class={`px-2 py-1 rounded text-xs font-medium transition-colors ${
              exportFormat.value === f
                ? 'bg-emerald-500 text-white'
                : 'bg-mist-200 dark:bg-mist-700 text-mist-700 dark:text-mist-200 hover:bg-mist-300 dark:hover:bg-mist-600'
            }`}
            onClick={() => { exportFormat.value = f }}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Progress bar */}
      {exporting.value && (
        <div class="flex-1 flex items-center gap-2">
          <div class="flex-1 h-1.5 bg-mist-200 dark:bg-mist-700 rounded-full overflow-hidden">
            <div
              class="h-full bg-emerald-500 transition-all"
              style={{ width: `${Math.round(ffmpegProgress.value * 100)}%` }}
            />
          </div>
          <span class="text-xs text-mist-500 dark:text-mist-400 shrink-0">
            {Math.round(ffmpegProgress.value * 100)}%
          </span>
        </div>
      )}

      {error.value && (
        <span class="text-xs text-red-500 flex-1">{error.value}</span>
      )}

      {!exporting.value && !error.value && <div class="flex-1" />}

      {/* Download link */}
      {exportUrl.value && !exporting.value && (
        <a
          href={exportUrl.value}
          download={`splicer-export.${exportFormat.value}`}
          draggable
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-500 hover:bg-emerald-600 text-white transition-colors"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download
        </a>
      )}

      {/* Export button */}
      <button
        onClick={handleExport}
        onMouseEnter={initFFmpeg}
        disabled={exporting.value || !hasSegments}
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
      >
        {exporting.value ? (
          <>
            <svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            Exporting…
          </>
        ) : (
          <>
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Export
          </>
        )}
      </button>
    </div>
  )
}
