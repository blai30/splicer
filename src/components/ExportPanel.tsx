import { useSignal } from '@preact/signals'
import clsx from 'clsx/lite'
import { CirclePlay, X, AlertTriangle } from 'lucide-preact'

import { exportVideo, cancelExport, getFfmpeg } from '@/lib/ffmpeg'
import { info, error as logError } from '@/lib/logger'
import {
  clips,
  exportFormat,
  addExportRecord,
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

function OptionButtonGroup<T extends string>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string
  options: { value: T; label: string }[]
  selected: T
  onSelect: (value: T) => void
}) {
  return (
    <div class="flex flex-wrap items-center gap-2">
      <span class="w-14 text-sm text-slate-500 dark:text-slate-400">{label}</span>
      {options.map((option) => (
        <button
          key={option.value}
          class={clsx(
            selected === option.value
              ? 'bg-violet-500 text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100',
            'rounded px-2.5 py-1 text-sm font-medium transition-colors hover:duration-0'
          )}
          onClick={() => onSelect(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function ExportPanel() {
  const exporting = useSignal(false)
  const error = useSignal<string | null>(null)

  function estimateSize(): number {
    // Estimate export size based on source bytes and quality preset heuristics.
    const segments = timeline.value
    let total = 0
    for (const segment of segments) {
      const clip = clips.value.find((clip) => clip.id === segment.clipId)
      if (!clip) continue
      const clipBytes = (clip.file as File).size ?? 0
      const durRatio = (segment.endTime - segment.startTime) / Math.max(1, clip.duration)
      total += clipBytes * durRatio
    }

    // Adjust by quality: lossless ~1x, high~0.5x, medium~0.25x, low~0.12x
    const factorMap: Record<Quality, number> = {
      lossless: 1,
      high: 0.5,
      medium: 0.25,
      low: 0.12,
    }

    return Math.max(0, Math.round(total * factorMap[quality.value]))
  }

  async function initFFmpeg() {
    if (ffmpegReady.value) return
    await getFfmpeg()
  }

  async function handleExport() {
    if (timeline.value.length === 0) return
    exporting.value = true
    error.value = null
    try {
      info('Export initiated', {
        format: exportFormat.value,
        quality: quality.value,
        fps: framerate.value,
        segments: timeline.value.length,
      })
      const segments = timeline.value
      const filename = makeFilename(exportFormat.value)
      let url: string
      let size: number
      const out = await exportVideo(segments, exportFormat.value, quality.value, framerate.value)
      url = out.url
      size = out.size

      const totalDuration = segments.reduce(
        (acc, segment) => acc + (segment.endTime - segment.startTime),
        0
      )
      const firstClip = clips.value.find((clip) => clip.id === segments[0].clipId)
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
      addExportRecord(record)
      info('Export finished', { filename, size })
    } catch (e) {
      logError('Export failed', { message: e instanceof Error ? e.message : String(e) })
      if (exporting.value) error.value = e instanceof Error ? e.message : 'Export failed'
    } finally {
      exporting.value = false
    }
  }

  function handleCancel() {
    exporting.value = false
    cancelExport()
    info('Export cancelled by user')
  }

  const formats: { value: ExportFormat; label: string }[] = [
    { value: 'mp4', label: 'MP4' },
    { value: 'mkv', label: 'MKV' },
    { value: 'webm', label: 'WebM' },
  ]
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
  const currentProgress = ffmpegProgress.value
  const progressPct = Math.max(0, Math.min(100, Math.round(currentProgress * 100)))
  const estimatedSize = estimateSize()
  const estimatedSizeMB = Math.round((estimatedSize / 1024 / 1024) * 10) / 10

  const totalDuration = timeline.value.reduce(
    (acc, segment) => acc + (segment.endTime - segment.startTime),
    0
  )

  const maxClip = (() => {
    let w = 0
    let h = 0
    for (const segment of timeline.value) {
      const clip = clips.value.find((c) => c.id === segment.clipId)
      if (!clip) continue
      w = Math.max(w, clip.width ?? 0)
      h = Math.max(h, clip.height ?? 0)
    }
    return { w, h }
  })()

  // Heuristics for WebM/VP9 in-browser limits. Tunable thresholds.
  const webmWarnMB = 50
  const webmDangerMB = 150
  let warnSeverity: 'none' | 'warn' | 'danger' = 'none'
  if (exportFormat.value === 'webm') {
    if (estimatedSizeMB > webmDangerMB || maxClip.w >= 2160 || totalDuration > 120)
      warnSeverity = 'danger'
    else if (estimatedSizeMB > webmWarnMB || maxClip.w >= 1280 || totalDuration > 30)
      warnSeverity = 'warn'
  }

  if (!hasSegments) return null

  return (
    <div class="flex shrink-0 flex-col gap-3 rounded-lg border border-slate-200/60 bg-slate-50/40 px-4 py-3 backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/40">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
          Export
        </span>
      </div>

      <div class="grid gap-2">
        <OptionButtonGroup
          label="Format"
          options={formats}
          selected={exportFormat.value}
          onSelect={(value) => {
            exportFormat.value = value
          }}
        />
        <OptionButtonGroup
          label="Quality"
          options={qualities}
          selected={quality.value}
          onSelect={(value) => {
            quality.value = value
          }}
        />
        <OptionButtonGroup
          label="FPS"
          options={framerates}
          selected={framerate.value}
          onSelect={(value) => {
            framerate.value = value
          }}
        />
      </div>

      <div class="flex flex-col gap-4 border-t border-slate-200/60 pt-2 sm:flex-row sm:items-center dark:border-slate-700/60">
        <div class="flex min-h-13 min-w-0 flex-1 flex-col gap-1">
          <div class="mb-1 text-sm text-slate-500 dark:text-slate-400">
            Estimated export size:{' '}
            {estimatedSize > 0 ? `${Math.round(estimatedSize / 1024 / 1024)} MB` : '—'}
          </div>
          {exportFormat.value === 'webm' && warnSeverity !== 'none' && (
            <div
              class={clsx(
                'rounded-md p-2 text-sm',
                warnSeverity === 'danger'
                  ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                  : 'bg-yellow-50 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300'
              )}
              role="alert"
            >
              <div class="flex items-start gap-2">
                <span className="flex h-lh items-center">
                  <AlertTriangle class="m-0.5 size-4.5 flex-none shrink-0" />
                </span>
                <div>
                  <div class="font-medium">
                    {warnSeverity === 'danger'
                      ? 'Export likely to fail'
                      : 'Export may be slow or fail'}
                  </div>
                  <div class="text-sm text-current/90">
                    WebM (VP9) encoding in the browser is CPU- and memory-intensive.
                  </div>
                </div>
              </div>
            </div>
          )}
          {exporting.value && !ffmpegReady.value && (
            <div class="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <div class="h-2 w-2 animate-pulse rounded-full bg-violet-500" />
              <span role="status" aria-live="polite">
                Initializing FFmpeg…
              </span>
            </div>
          )}
          {exporting.value && (
            <div
              class="flex items-center gap-2"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <div class="h-1.5 flex-1 overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
                <div
                  class="h-full bg-violet-500 transition-all"
                  style={{ width: `${progressPct}%` }}
                  aria-valuenow={progressPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
              <span class="w-8 shrink-0 text-right text-sm text-slate-500 dark:text-slate-400">
                {progressPct}%
              </span>
            </div>
          )}
          {error.value && (
            <div role="alert" class="text-sm font-medium text-red-600 dark:text-red-400">
              Export failed: {error.value}
            </div>
          )}
        </div>

        {exporting.value ? (
          <button
            onClick={handleCancel}
            class="inline-flex h-10 w-42 items-center justify-center gap-1.5 rounded bg-slate-100 px-4 text-base font-semibold text-slate-600 transition-colors hover:bg-red-100 hover:text-red-600 hover:duration-0 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:bg-red-900/30 dark:hover:text-red-400"
          >
            <X class="h-4 w-4" />
            Cancel Export
          </button>
        ) : (
          <button
            onClick={handleExport}
            onMouseEnter={initFFmpeg}
            disabled={!hasSegments}
            class="inline-flex h-10 w-42 items-center justify-center gap-2 rounded bg-violet-500 px-4 text-base font-semibold text-white transition-colors hover:bg-violet-600 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CirclePlay class="h-4 w-4" />
            Export Video
          </button>
        )}
      </div>
    </div>
  )
}
