import { useSignal } from '@preact/signals'
import clsx from 'clsx/lite'
import { CirclePlay, X } from 'lucide-preact'

import { exportVideo, cancelExport, getFFmpeg } from '@/lib/ffmpeg'
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
  const progressPct = Math.round(ffmpegProgress.value * 100)

  if (!hasSegments) return null

  return (
    <div class="sticky bottom-3 z-20 flex shrink-0 flex-col gap-3 rounded-xl border border-slate-200/80 bg-white/95 px-4 py-3 shadow-lg shadow-slate-900/10 backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/95 dark:shadow-black/30">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
          Export
        </span>
      </div>

      <div class="grid gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="w-14 text-sm text-slate-500 dark:text-slate-400">Format</span>
          {formats.map((f) => (
            <button
              key={f}
              class={clsx(
                exportFormat.value === f
                  ? 'rounded-md bg-violet-500 px-2.5 py-1 text-sm font-medium text-white transition-colors'
                  : 'rounded-md bg-slate-200 px-2.5 py-1 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
              )}
              onClick={() => {
                exportFormat.value = f
              }}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <span class="w-14 text-sm text-slate-500 dark:text-slate-400">Quality</span>
          {qualities.map((q) => (
            <button
              key={q.value}
              class={clsx(
                quality.value === q.value
                  ? 'rounded-md bg-violet-500 px-2.5 py-1 text-sm font-medium text-white transition-colors'
                  : 'rounded-md bg-slate-200 px-2.5 py-1 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
              )}
              onClick={() => {
                quality.value = q.value
              }}
            >
              {q.label}
            </button>
          ))}
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <span class="w-14 text-sm text-slate-500 dark:text-slate-400">FPS</span>
          {framerates.map((f) => (
            <button
              key={f.value}
              class={clsx(
                framerate.value === f.value
                  ? 'rounded-md bg-violet-500 px-2.5 py-1 text-sm font-medium text-white transition-colors'
                  : 'rounded-md bg-slate-200 px-2.5 py-1 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
              )}
              onClick={() => {
                framerate.value = f.value
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div class="flex flex-col gap-2 border-t border-slate-200/80 pt-2 sm:flex-row sm:items-center dark:border-slate-700/80">
        <div class="min-w-0 flex-1">
          {exporting.value && !ffmpegReady.value && (
            <span class="text-sm text-slate-500 dark:text-slate-400">Initializing FFmpeg…</span>
          )}
          {exporting.value && ffmpegReady.value && (
            <div class="flex items-center gap-2">
              <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  class="h-full bg-violet-500 transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span class="w-8 shrink-0 text-right text-sm text-slate-500 dark:text-slate-400">
                {progressPct}%
              </span>
            </div>
          )}
          {error.value && <span class="text-sm text-red-500">{error.value}</span>}
        </div>

        {exporting.value ? (
          <button
            onClick={handleCancel}
            class="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-slate-200 px-4 text-base font-semibold text-slate-700 transition-colors hover:bg-red-100 hover:text-red-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-red-900/40 dark:hover:text-red-400"
          >
            <X class="h-4 w-4" />
            Cancel Export
          </button>
        ) : (
          <button
            onClick={handleExport}
            onMouseEnter={initFFmpeg}
            disabled={!hasSegments}
            class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-violet-500 px-4 text-base font-semibold text-white transition-colors hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CirclePlay class="h-4 w-4" />
            Export Video
          </button>
        )}
      </div>
    </div>
  )
}
