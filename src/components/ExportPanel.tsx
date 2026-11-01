import { useSignal } from '@preact/signals'
import clsx from 'clsx/lite'
import { AlertTriangle, CircleCheck, CirclePlay, Info, X } from 'lucide-preact'

import { ExportFaq } from '@/components/ExportFaq'
import { setOutputLock } from '@/lib/advanced/advancedEditing'
import {
  buildCompositorJob,
  runAdvancedExport,
  visibleAdvancedSegments,
} from '@/lib/advanced/advancedExport'
import { projectDuration } from '@/lib/advanced/advancedTimelineDomain'
import { findOversizedAutoCanvas, type OversizedCanvas } from '@/lib/advanced/exportLayout'
import { buildJob, runExportEngine } from '@/lib/exportEngine'
import { assessFeasibility } from '@/lib/exportFeasibility'
import { cancelExport, ExportCanceledError } from '@/lib/exportRunner'
import { formatSize, formatSizeRange, formatTimecode } from '@/lib/format'
import { info, error as logError } from '@/lib/logger'
import {
  addExportRecord,
  advancedOutputLock,
  advancedSegments,
  appMode,
  clips,
  exportEtaSeconds,
  exportFormat,
  exporting,
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
import {
  estimatePlanBytes,
  type SizeEstimate,
  type SourceEquivalent,
} from '@/lib/webcodecs/bitrateModel'
import { buildCompositorPlan } from '@/lib/webcodecs/compositorPlan'
import { buildEditPlan } from '@/lib/webcodecs/editPlan'

function makeFilename(format: ExportFormat): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\.\d{3}Z$/, '')
  return `splicer-${timestamp}.${format}`
}

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'mkv', label: 'MKV' },
  { value: 'mov', label: 'MOV' },
  { value: 'webm', label: 'WebM' },
]
const QUALITIES: { value: Quality; label: string }[] = [
  // Stored as 'lossless' so persisted settings keep working.
  { value: 'lossless', label: 'Maximum' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]
// What each preset aims for, relative to the source when its bitrate is known.
const QUALITY_HINTS: Record<Quality, { relative: string; fixed: string }> = {
  lossless: {
    relative:
      'Maximum: up to 1.5× the source bitrate, to lose as little as possible. Usually larger than the source.',
    fixed: 'Maximum: a very high bitrate for the output size, to lose as little as possible.',
  },
  high: {
    relative: 'High: matches the source bitrate, so the file stays about the size of the source.',
    fixed: 'High: a generous bitrate for the output size.',
  },
  medium: {
    relative: 'Medium: about 60% of the source bitrate.',
    fixed: 'Medium: a moderate bitrate for the output size.',
  },
  low: {
    relative: 'Low: about 35% of the source bitrate, for the smallest file.',
    fixed: 'Low: a low bitrate for the output size, for the smallest file.',
  },
}

// Medium and Low are fractions in the output codec's terms, so converting from
// a more efficient codec keeps more of the source's bitrate.
const CONVERSION_HINT =
  ' The source uses a more efficient codec, so the same quality takes more bits here and the file shrinks less.'

const FRAMERATES: { value: Framerate; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: '60', label: '60 fps' },
  { value: '30', label: '30 fps' },
  { value: '24', label: '24 fps' },
]
const WEBM_CODECS: { value: WebmCodec; label: string }[] = [
  { value: 'vp9', label: 'VP9 (recommended)' },
  { value: 'vp8', label: 'VP8 (faster)' },
]
const MKV_CODECS: { value: MkvCodec; label: string }[] = [
  { value: 'h264', label: 'H.264 (recommended)' },
  { value: 'vp9', label: 'VP9' },
]

function OptionButtonGroup<T extends string>({
  label,
  options,
  selected,
  disabled,
  describedBy,
  onSelect,
}: {
  label: string
  options: { value: T; label: string }[]
  selected: T
  disabled?: boolean
  describedBy?: string
  onSelect: (value: T) => void
}) {
  // Radio-group keyboard pattern: arrows move and select, one tab stop.
  function onKeyDown(event: KeyboardEvent) {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
    if (!forward && !backward) return
    event.preventDefault()
    event.stopPropagation()
    if (disabled) return
    const index = options.findIndex((option) => option.value === selected)
    const next = options[(index + (forward ? 1 : -1) + options.length) % options.length]
    onSelect(next.value)
    const group = event.currentTarget as HTMLElement
    requestAnimationFrame(() =>
      group.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus()
    )
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
      class="flex flex-wrap items-center gap-2"
    >
      <span class="w-14 text-sm text-slate-500 dark:text-slate-400">{label}</span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          data-value={option.value}
          aria-checked={selected === option.value}
          tabIndex={selected === option.value ? 0 : -1}
          disabled={disabled}
          class={clsx(
            selected === option.value
              ? 'bg-violet-500 text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100',
            'rounded px-2.5 py-1 text-sm font-medium transition-colors hover:duration-0 focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50'
          )}
          onClick={() => onSelect(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

type Summary = {
  width: number
  height: number
  duration: number
  estimate: SizeEstimate
  // False when a source bitrate is unknown (or the Advanced layout mixes
  // sources), so presets fall back to fixed per-resolution bitrates.
  sourceRelative: boolean
  // The output codec needs more bits than the source's for the same quality.
  fromMoreEfficientCodec: boolean
  oversizedCanvas: OversizedCanvas | null
}

function sourceRelation(
  sourceEquivalent: SourceEquivalent | null
): Pick<Summary, 'sourceRelative' | 'fromMoreEfficientCodec'> {
  return {
    sourceRelative: sourceEquivalent !== null,
    fromMoreEfficientCodec:
      sourceEquivalent !== null && sourceEquivalent.codecAdjusted > sourceEquivalent.raw * 1.05,
  }
}

// Output size, duration, and a size estimate from the same plan the export
// worker builds, so the shown bitrate is the one the encoder is asked for.
function summarize(isAdvanced: boolean): Summary | null {
  const format = exportFormat.value
  const chosenQuality = quality.value
  const fps = framerate.value
  if (isAdvanced) {
    const job = buildCompositorJob(advancedSegments.value, format, chosenQuality, fps)
    if (!job) return null
    const plan = buildCompositorPlan(job)
    return {
      width: job.canvas.width,
      height: job.canvas.height,
      duration: projectDuration(advancedSegments.value),
      estimate: estimatePlanBytes(plan),
      ...sourceRelation(plan.sizeBasis.sourceEquivalent),
      oversizedCanvas:
        advancedOutputLock.value === null
          ? findOversizedAutoCanvas(visibleAdvancedSegments(advancedSegments.value))
          : null,
    }
  }
  const job = buildJob(timeline.value, format, chosenQuality, fps)
  if (!job || job.slices.length === 0) return null
  const plan = buildEditPlan(job)
  return {
    width: plan.outputWidth,
    height: plan.outputHeight,
    duration: plan.sizeBasis.durationSec,
    estimate: estimatePlanBytes(plan),
    ...sourceRelation(plan.sizeBasis.sourceEquivalent),
    oversizedCanvas: null,
  }
}

// Only a source-relative estimate can say much about the source, and only a
// clear margin over it is "likely": simple content often lands under the
// predicted encoder floor.
const LARGER_THAN_SOURCE_MARGIN = 1.1

function likelyLargerThanSource(summary: Summary): boolean {
  const { sourceBytes, expected } = summary.estimate
  return (
    summary.sourceRelative &&
    sourceBytes !== null &&
    expected > sourceBytes * LARGER_THAN_SOURCE_MARGIN
  )
}

function formatKbps(bitsPerSecond: number): string {
  return `${Math.round(bitsPerSecond / 1000)} kbps`
}

export function ExportPanel() {
  const error = useSignal<string | null>(null)
  const lastExport = useSignal<string | null>(null)

  const isAdvanced = appMode.value === 'advanced'
  const busy = exporting.value
  const hasContent = isAdvanced ? advancedSegments.value.length > 0 : timeline.value.length > 0
  // Export runs entirely through WebCodecs, so a VideoEncoder is required.
  const webcodecsAvailable = typeof VideoEncoder !== 'undefined'
  // Touch clips so the summary refreshes when probing data arrives.
  void clips.value
  const summary = hasContent ? summarize(isAdvanced) : null

  async function handleExport() {
    // Read the live flag: a fast double-click lands before the re-render.
    if (exporting.value || !summary) return
    // Capture settings now: the user may change them while the export runs.
    const format = exportFormat.value
    const chosenQuality = quality.value
    const fps = framerate.value
    const filename = makeFilename(format)
    error.value = null
    lastExport.value = null
    info('Export started', { mode: appMode.value, format, quality: chosenQuality, fps })
    try {
      const output = isAdvanced
        ? await runAdvancedExport(format, chosenQuality, fps)
        : await runExportEngine(timeline.value, format, chosenQuality, fps)
      const record: ExportRecord = {
        id: crypto.randomUUID(),
        filename,
        url: output.url,
        size: output.size,
        duration: summary.duration,
        fps,
        width: output.width,
        height: output.height,
        format,
        estimatedBytes: Math.round(summary.estimate.expected),
      }
      addExportRecord(record)
      lastExport.value = filename
      // Actual against estimate, to recalibrate the model on real encoders.
      info('Export finished', {
        filename,
        size: record.size,
        estimatedBytes: record.estimatedBytes,
        actualOverEstimate: Number((record.size / summary.estimate.expected).toFixed(2)),
      })
    } catch (err) {
      if (err instanceof ExportCanceledError) {
        info('Export canceled')
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      logError('Export failed', { message })
      error.value = message
    }
  }

  const progressPct = Math.max(0, Math.min(100, Math.round(exportProgress.value * 100)))
  const feasibility = summary
    ? assessFeasibility({
        width: summary.width,
        height: summary.height,
        durationSec: summary.duration,
        format: exportFormat.value,
        threads: null,
      })
    : null

  return (
    <div class="flex shrink-0 flex-col gap-4 rounded-lg border border-slate-200/60 bg-slate-50/40 px-4 py-3 backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/40">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-sm font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
          Export
        </h2>
        <ExportFaq />
      </div>

      <div class="grid gap-2">
        <OptionButtonGroup
          label="Format"
          options={FORMATS}
          selected={exportFormat.value}
          disabled={busy}
          onSelect={(value) => (exportFormat.value = value)}
        />
        <OptionButtonGroup
          label="Quality"
          options={QUALITIES}
          selected={quality.value}
          disabled={busy}
          describedBy="export-quality-hint"
          onSelect={(value) => (quality.value = value)}
        />
        <p id="export-quality-hint" class="text-sm text-slate-500 sm:pl-16 dark:text-slate-400">
          {summary && !summary.sourceRelative
            ? QUALITY_HINTS[quality.value].fixed
            : QUALITY_HINTS[quality.value].relative}
          {summary?.fromMoreEfficientCodec &&
            (quality.value === 'medium' || quality.value === 'low') &&
            CONVERSION_HINT}
        </p>
        <OptionButtonGroup
          label="FPS"
          options={FRAMERATES}
          selected={framerate.value}
          disabled={busy}
          onSelect={(value) => (framerate.value = value)}
        />
        {exportFormat.value === 'webm' && (
          <OptionButtonGroup
            label="Codec"
            options={WEBM_CODECS}
            selected={webmCodec.value}
            disabled={busy}
            onSelect={(value) => (webmCodec.value = value)}
          />
        )}
        {exportFormat.value === 'mkv' && (
          <OptionButtonGroup
            label="Codec"
            options={MKV_CODECS}
            selected={mkvCodec.value}
            disabled={busy}
            onSelect={(value) => (mkvCodec.value = value)}
          />
        )}
      </div>

      <div class="flex flex-col gap-4 border-t border-slate-200/60 pt-4 sm:flex-row sm:items-start dark:border-slate-700/60">
        {busy ? (
          <button
            type="button"
            onClick={cancelExport}
            class="inline-flex h-10 w-full shrink-0 items-center justify-center gap-1.5 rounded bg-slate-100 px-4 text-base font-semibold text-slate-600 transition-colors hover:bg-red-100 hover:text-red-600 hover:duration-0 sm:w-44 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:bg-red-900/30 dark:hover:text-red-400"
          >
            <X class="size-4" />
            Cancel export
          </button>
        ) : (
          <button
            type="button"
            onClick={handleExport}
            disabled={!summary || !webcodecsAvailable}
            class="inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded bg-violet-500 px-4 text-base font-semibold text-white transition-colors hover:bg-violet-600 hover:duration-0 focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 sm:w-44"
          >
            <CirclePlay class="size-4" />
            Export video
          </button>
        )}
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <p class="text-sm text-slate-500 tabular-nums dark:text-slate-400">
            {summary ? (
              <>
                {summary.width}×{summary.height} · {formatTimecode(summary.duration)} · ~
                {formatSize(summary.estimate.expected)} (
                {formatSizeRange(summary.estimate.low, summary.estimate.high)})
                {summary.estimate.sourceBytes !== null && (
                  <> · source {formatSize(summary.estimate.sourceBytes)}</>
                )}
              </>
            ) : hasContent ? (
              'Nothing visible to export. Show a hidden track or add a clip.'
            ) : isAdvanced ? (
              'Add a clip to the canvas to export.'
            ) : (
              'Add a clip to the timeline to export.'
            )}
          </p>
          {summary && likelyLargerThanSource(summary) && (
            <div class="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              <Info class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                {summary.estimate.belowEncoderFloor
                  ? `Likely larger than the source. The source is more compressed than the encoder can go at ${summary.width}×${summary.height} (about ${formatKbps(summary.estimate.encoderFloorBitrate)} of video), so a lower quality will not shrink it much.`
                  : 'Likely larger than the source. Pick a lower quality for a smaller file.'}
              </p>
            </div>
          )}
          {summary?.oversizedCanvas && (
            <div class="flex flex-wrap items-start gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              <Info class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p class="min-w-0 flex-1">
                Clips that play together span {summary.oversizedCanvas.canvas.width}×
                {summary.oversizedCanvas.canvas.height}, much larger than any single clip. The empty
                area exports as black and makes the file bigger.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setOutputLock(
                    summary.oversizedCanvas!.suggested.width,
                    summary.oversizedCanvas!.suggested.height
                  )
                }
                class="shrink-0 rounded bg-amber-100 px-2.5 py-1 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-200 hover:duration-0 focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-amber-900/40 dark:text-amber-200 dark:hover:bg-amber-900/60"
              >
                Lock to {summary.oversizedCanvas.suggested.width}×
                {summary.oversizedCanvas.suggested.height}
              </button>
            </div>
          )}
          {!webcodecsAvailable && (
            <div
              class="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
              role="alert"
            >
              This browser has no WebCodecs video encoder, so export is unavailable. Try a recent
              version of Chrome, Edge, Firefox, or Safari.
            </div>
          )}
          {feasibility && feasibility.band !== 'green' && (
            <div
              class={clsx(
                'flex items-start gap-2 rounded-md p-2 text-sm',
                feasibility.band === 'red'
                  ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                  : 'bg-yellow-50 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300'
              )}
            >
              <AlertTriangle class="mt-0.5 size-4 shrink-0" />
              <div>
                <div class="font-medium">
                  {feasibility.band === 'red' ? 'Export likely to fail' : 'Export may be slow'}
                </div>
                <div>{feasibility.reason}</div>
              </div>
            </div>
          )}
          {busy && (
            <div class="flex items-center gap-2" role="status" aria-live="polite">
              <div
                class="h-1.5 flex-1 overflow-hidden rounded bg-slate-200 dark:bg-slate-700"
                role="progressbar"
                aria-label="Export progress"
                aria-valuenow={progressPct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  class="h-full bg-violet-500 transition-[width]"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span class="w-10 shrink-0 text-right text-sm text-slate-500 tabular-nums dark:text-slate-400">
                {progressPct}%
              </span>
              {exportEtaSeconds.value !== null && (
                <span class="shrink-0 text-sm text-slate-500 tabular-nums dark:text-slate-400">
                  ~{formatDuration(exportEtaSeconds.value)} left
                </span>
              )}
            </div>
          )}
          {!busy && lastExport.value && (
            <p
              role="status"
              class="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400"
            >
              <CircleCheck class="size-4" />
              Exported {lastExport.value}. Download it from the export library below.
            </p>
          )}
          {error.value && (
            <div
              role="alert"
              class="flex items-start gap-2 rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
            >
              <span class="flex-1">Export failed: {error.value}</span>
              <button
                type="button"
                onClick={() => (error.value = null)}
                class="shrink-0 rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/50"
                aria-label="Dismiss error"
              >
                <X class="size-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function formatDuration(seconds: number): string {
  const total = Math.max(1, Math.round(seconds))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  return `${minutes}m ${String(total % 60).padStart(2, '0')}s`
}
