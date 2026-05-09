import { useSignal } from '@preact/signals'
import {
  clips,
  exportFormat,
  exportHistory,
  ffmpegProgress,
  ffmpegReady,
  framerate,
  quality,
  timeline,
} from '@/lib/store'
import type { ExportFormat, ExportRecord, Framerate, Quality } from '@/lib/types'
import { exportVideo, cancelExport, getFFmpeg } from '@/lib/ffmpeg'

function makeFilename(format: ExportFormat): string {
  const ts = new Date()
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\.\d{3}Z$/, '')
  return `splicer-${ts}.${format}`
}

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
    try {
      const segs = timeline.value
      const filename = makeFilename(exportFormat.value)
      const { url, size } = await exportVideo(
        segs,
        exportFormat.value,
        quality.value,
        framerate.value
      )

      const totalDuration = segs.reduce((acc, s) => acc + (s.endTime - s.startTime), 0)
      const firstClip = clips.value.find((c) => c.id === segs[0].clipId)
      const record: ExportRecord = {
        id: crypto.randomUUID(),
        filename,
        url,
        size,
        duration: totalDuration,
        fps: framerate.value,
        width: firstClip?.width ?? 0,
        height: firstClip?.height ?? 0,
        format: exportFormat.value,
      }
      exportHistory.value = [record, ...exportHistory.value]
    } catch (e) {
      if (exporting.value) error.value = e instanceof Error ? e.message : 'Export failed'
    } finally {
      exporting.value = false
    }
  }

  function handleCancel() {
    exporting.value = false
    cancelExport()
  }

  const formats: ExportFormat[] = ['mp4', 'webm', 'mkv']
  const qualities: { value: Quality; label: string }[] = [
    { value: 'lossless', label: 'Lossless' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
  ]
  const framerates: { value: Framerate; label: string }[] = [
    { value: 'original', label: 'Original' },
    { value: '60', label: '60 fps' },
    { value: '30', label: '30 fps' },
    { value: '24', label: '24 fps' },
  ]

  const hasSegments = timeline.value.length > 0
  const btnBase = 'px-2.5 py-1 rounded text-xs font-medium transition-colors'
  const btnActive = `${btnBase} bg-violet-500 text-white`
  const btnInactive = `${btnBase} bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-700`

  return (
    <div class="flex shrink-0 flex-col gap-2.5 rounded-lg bg-slate-100 px-4 py-3 dark:bg-slate-900">
      {/* Options grid */}
      <div class="grid items-center gap-x-4 gap-y-1.5" style={{ gridTemplateColumns: '4rem 1fr' }}>
        <span class="text-xs text-slate-500 dark:text-slate-400">Format</span>
        <div class="flex gap-1.5">
          {formats.map((f) => (
            <button
              key={f}
              class={exportFormat.value === f ? btnActive : btnInactive}
              onClick={() => {
                exportFormat.value = f
              }}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>

        <span class="text-xs text-slate-500 dark:text-slate-400">Quality</span>
        <div class="flex gap-1.5">
          {qualities.map((q) => (
            <button
              key={q.value}
              class={quality.value === q.value ? btnActive : btnInactive}
              onClick={() => {
                quality.value = q.value
              }}
            >
              {q.label}
            </button>
          ))}
        </div>

        <span class="text-xs text-slate-500 dark:text-slate-400">FPS</span>
        <div class="flex gap-1.5">
          {framerates.map((f) => (
            <button
              key={f.value}
              class={framerate.value === f.value ? btnActive : btnInactive}
              onClick={() => {
                framerate.value = f.value
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Export row */}
      <div class="flex items-center gap-3">
        {exporting.value && !ffmpegReady.value && (
          <span class="flex-1 text-xs text-slate-400 dark:text-slate-500">
            Initializing FFmpeg…
          </span>
        )}
        {exporting.value && ffmpegReady.value && (
          <div class="flex flex-1 items-center gap-2">
            <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                class="h-full bg-violet-500 transition-all"
                style={{ width: `${Math.round(ffmpegProgress.value * 100)}%` }}
              />
            </div>
            <span class="w-8 shrink-0 text-right text-xs text-slate-500 dark:text-slate-400">
              {Math.round(ffmpegProgress.value * 100)}%
            </span>
          </div>
        )}

        {error.value && <span class="flex-1 text-xs text-red-500">{error.value}</span>}
        {!exporting.value && !error.value && <div class="flex-1" />}

        {exporting.value ? (
          <button
            onClick={handleCancel}
            class="flex items-center gap-1.5 rounded-md bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-red-100 hover:text-red-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-red-900/40 dark:hover:text-red-400"
          >
            <svg
              class="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Cancel
          </button>
        ) : (
          <button
            onClick={handleExport}
            onMouseEnter={initFFmpeg}
            disabled={!hasSegments}
            class="flex items-center gap-1.5 rounded-md bg-violet-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg
              class="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
              />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Export
          </button>
        )}
      </div>
    </div>
  )
}
