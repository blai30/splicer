import { useSignal } from '@preact/signals'
import clsx from 'clsx/lite'
import { CirclePlay, X, AlertTriangle } from 'lucide-preact'

import { ExportFaq } from '@/components/ExportFaq'
import { cancelAdvancedExport, runAdvancedExport } from '@/lib/advanced/advancedExport'
import { runExportEngine, cancelActiveExport } from '@/lib/exportEngine'
import { assessFeasibility } from '@/lib/exportFeasibility'
import { formatTimecode } from '@/lib/format'
import { info, error as logError } from '@/lib/logger'
import {
  advancedCanvas,
  advancedSegments,
  appMode,
  clips,
  exportEtaSeconds,
  exportFormat,
  addExportRecord,
  exportProgress,
  framerate,
  mkvCodec,
  quality,
  timeline,
  webmCodec,
} from '@/lib/store'
import type {
  ExportFormat,
  ExportRecord,
  Framerate,
  MkvCodec,
  Quality,
  WebmCodec,
} from '@/lib/types'

function makeFilename(format: ExportFormat): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\.\d{3}Z$/, '')
  return `splicer-${timestamp}.${format}`
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
      const durationRatio = (segment.endTime - segment.startTime) / Math.max(1, clip.duration)
      total += clipBytes * durationRatio
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

  async function handleExport() {
    if (!hasSegments) return
    exporting.value = true
    error.value = null
    try {
      const filename = makeFilename(exportFormat.value)
      let record: ExportRecord

      if (isAdvanced) {
        info('Advanced export initiated', {
          format: exportFormat.value,
          quality: quality.value,
          fps: framerate.value,
        })
        const out = await runAdvancedExport(exportFormat.value, quality.value, framerate.value)
        record = {
          id: crypto.randomUUID(),
          filename,
          url: out.url,
          size: out.size,
          duration: out.duration,
          fps: framerate.value,
          width: out.width,
          height: out.height,
          format: exportFormat.value,
        }
      } else {
        info('Export initiated', {
          format: exportFormat.value,
          quality: quality.value,
          fps: framerate.value,
          segments: timeline.value.length,
        })
        const segments = timeline.value
        const out = await runExportEngine(
          segments,
          exportFormat.value,
          quality.value,
          framerate.value
        )
        const totalDuration = segments.reduce(
          (acc, segment) => acc + (segment.endTime - segment.startTime),
          0
        )
        const firstClip = clips.value.find((clip) => clip.id === segments[0].clipId)
        record = {
          id: crypto.randomUUID(),
          filename,
          url: out.url,
          size: out.size,
          duration: totalDuration,
          fps: framerate.value,
          width: firstClip?.width ?? 0,
          height: firstClip?.height ?? 0,
          format: exportFormat.value,
        }
      }

      addExportRecord(record)
      info('Export finished', { filename, size: record.size })
    } catch (err) {
      logError('Export failed', { message: err instanceof Error ? err.message : String(err) })
      if (exporting.value) error.value = err instanceof Error ? err.message : 'Export failed'
    } finally {
      exporting.value = false
    }
  }

  function handleCancel() {
    exporting.value = false
    if (isAdvanced) cancelAdvancedExport()
    else cancelActiveExport()
    info('Export canceled by user')
  }

  const formats: { value: ExportFormat; label: string }[] = [
    { value: 'mp4', label: 'MP4' },
    { value: 'mkv', label: 'MKV' },
    { value: 'mov', label: 'MOV' },
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
  const webmCodecs: { value: WebmCodec; label: string }[] = [
    { value: 'vp9', label: 'VP9 (recommended)' },
    { value: 'vp8', label: 'VP8 (faster)' },
  ]
  const mkvCodecs: { value: MkvCodec; label: string }[] = [
    { value: 'h264', label: 'H.264 (recommended)' },
    { value: 'vp9', label: 'VP9' },
  ]

  const isAdvanced = appMode.value === 'advanced'
  const hasSegments = isAdvanced ? advancedSegments.value.length > 0 : timeline.value.length > 0
  // Export runs entirely through WebCodecs, so a VideoEncoder is required.
  const webcodecsAvailable = typeof VideoEncoder !== 'undefined'
  const currentProgress = exportProgress.value
  const progressPct = Math.max(0, Math.min(100, Math.round(currentProgress * 100)))
  const estimatedSize = estimateSize()

  const totalDuration = timeline.value.reduce(
    (acc, segment) => acc + (segment.endTime - segment.startTime),
    0
  )

  const maxClip = (() => {
    let width = 0
    let height = 0
    for (const segment of timeline.value) {
      const clip = clips.value.find((clip) => clip.id === segment.clipId)
      if (!clip) continue
      width = Math.max(width, clip.width ?? 0)
      height = Math.max(height, clip.height ?? 0)
    }
    return { width, height }
  })()

  const feasibility = assessFeasibility({
    width: maxClip.width,
    height: maxClip.height,
    durationSec: totalDuration,
    format: exportFormat.value,
    threads: null,
  })

  return (
    <div class="flex shrink-0 flex-col gap-4 rounded-lg border border-slate-200/60 bg-slate-50/40 px-4 py-3 backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/40">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
          Export
        </span>
        <ExportFaq />
        <span
          class="rounded bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
          title="Exported with the browser's native WebCodecs engine"
        >
          WebCodecs
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
        {exportFormat.value === 'webm' && (
          <OptionButtonGroup
            label="Codec"
            options={webmCodecs}
            selected={webmCodec.value}
            onSelect={(value) => {
              webmCodec.value = value
            }}
          />
        )}
        {exportFormat.value === 'mkv' && (
          <OptionButtonGroup
            label="Codec"
            options={mkvCodecs}
            selected={mkvCodec.value}
            onSelect={(value) => {
              mkvCodec.value = value
            }}
          />
        )}
      </div>

      <div class="mt-4 flex flex-col gap-4 border-t border-slate-200/60 pt-6 sm:flex-row sm:items-center dark:border-slate-700/60">
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
            disabled={!hasSegments || !webcodecsAvailable}
            class="inline-flex h-10 w-42 items-center justify-center gap-2 rounded bg-violet-500 px-4 text-base font-semibold text-white transition-colors hover:bg-violet-600 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CirclePlay class="h-4 w-4" />
            Export Video
          </button>
        )}
        <div class="flex min-h-13 min-w-0 flex-1 flex-col gap-1">
          <div class="mb-1 text-sm text-slate-500 dark:text-slate-400">
            {isAdvanced ? (
              hasSegments ? (
                <>
                  Output: {advancedCanvas.value.width}x{advancedCanvas.value.height},{' '}
                  {formatTimecode(
                    advancedSegments.value.reduce(
                      (acc, segment) => acc + (segment.sourceEnd - segment.sourceStart),
                      0
                    )
                  )}
                </>
              ) : (
                'Add a clip to the canvas to export.'
              )
            ) : hasSegments ? (
              <>
                Estimated export size:{' '}
                {estimatedSize > 0 ? `${Math.round(estimatedSize / 1024 / 1024)} MB` : '-'}
              </>
            ) : (
              'Add a clip to the timeline to export.'
            )}
          </div>
          {!webcodecsAvailable && (
            <div
              class="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
              role="alert"
            >
              This browser has no WebCodecs video encoder, so export is unavailable. Try a recent
              version of Chrome, Edge, or Safari.
            </div>
          )}
          {!isAdvanced && feasibility.band !== 'green' && (
            <div
              class={clsx(
                'rounded-md p-2 text-sm',
                feasibility.band === 'red'
                  ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                  : 'bg-yellow-50 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300'
              )}
              role="alert"
            >
              <div class="flex items-start gap-2">
                <span class="flex h-lh items-center">
                  <AlertTriangle class="m-0.5 size-4.5 flex-none shrink-0" />
                </span>
                <div>
                  <div class="font-medium">
                    {feasibility.band === 'red' ? 'Export likely to fail' : 'Export may be slow'}
                  </div>
                  <div class="text-sm text-current/90">{feasibility.reason}</div>
                </div>
              </div>
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
              {exportEtaSeconds.value !== null && (
                <span class="shrink-0 text-sm text-slate-500 tabular-nums dark:text-slate-400">
                  ~{Math.max(1, Math.round(exportEtaSeconds.value))}s left
                </span>
              )}
            </div>
          )}
          {error.value && (
            <div role="alert" class="text-sm font-medium text-red-600 dark:text-red-400">
              Export failed: {error.value}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
