import { useSignal } from '@preact/signals'
import clsx from 'clsx/lite'
import { AlertTriangle, CircleCheck, CirclePlay, Info, X } from 'lucide-preact'
import { Fragment } from 'preact'

import { ExportFaq } from '@/components/ExportFaq'
import { setOutputLock } from '@/lib/advanced/advancedEditing'
import {
  buildCompositorJob,
  runAdvancedExport,
  visibleAdvancedSegments,
} from '@/lib/advanced/advancedExport'
import { projectDuration } from '@/lib/advanced/advancedTimelineDomain'
import { findOversizedAutoCanvas, type OversizedCanvas } from '@/lib/advanced/exportLayout'
import { copyBlockerReasons, copyPreview, type CopyPreview } from '@/lib/copyExport'
import { buildJob, runExportEngine, type SizingOptions } from '@/lib/exportEngine'
import { assessFeasibility } from '@/lib/exportFeasibility'
import { cancelExport, ExportCanceledError } from '@/lib/exportRunner'
import { LARGE_SNAP_SHIFT_SEC } from '@/lib/fastCopy'
import { formatPreciseTime, formatSize, formatSizeRange, formatTimecode } from '@/lib/format'
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
  resolution,
  TARGET_SIZE_MAX_MB,
  TARGET_SIZE_MIN_MB,
  TARGET_SIZE_PRESETS_MB,
  targetSizeMB,
  timeline,
  webmCodec,
} from '@/lib/store'
import type {
  ExportFormat,
  ExportRecord,
  Framerate,
  MkvCodec,
  QualityChoice,
  Resolution,
  WebmCodec,
} from '@/lib/types'
import {
  estimatePlanBytes,
  MUX_OVERHEAD,
  type SizeEstimate,
  type SourceEquivalent,
  type TargetSizeFit,
} from '@/lib/webcodecs/bitrateModel'
import { buildCompositorPlan } from '@/lib/webcodecs/compositorPlan'
import { buildEditPlan } from '@/lib/webcodecs/editPlan'
import { RESOLUTION_SHORT_SIDE } from '@/lib/webcodecs/outputSize'

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
const QUALITIES: { value: QualityChoice; label: string }[] = [
  { value: 'original', label: 'Original (no re-encode)' },
  // Stored as 'lossless' so persisted settings keep working.
  { value: 'lossless', label: 'Maximum' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'target', label: 'Target size' },
]
const ORIGINAL_HINT =
  'Original: copies the source video as it is, with no quality loss, at about the source size. Each cut moves back to the key frame before it; audio is re-encoded.'
const TARGET_HINT =
  'Target size: aims the whole file at the size you pick. When that leaves too few bits for the picture, the resolution drops, then the frame rate.'
// What each choice aims for, relative to the source when its bitrate is known.
const QUALITY_HINTS: Record<QualityChoice, { relative: string; fixed: string }> = {
  original: { relative: ORIGINAL_HINT, fixed: ORIGINAL_HINT },
  target: { relative: TARGET_HINT, fixed: TARGET_HINT },
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
const RESOLUTIONS: { value: Resolution; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
]
const TARGET_SIZES = TARGET_SIZE_PRESETS_MB.map((megabytes) => ({
  value: String(megabytes),
  label: `${megabytes} MB`,
}))
const WEBM_CODECS: { value: WebmCodec; label: string }[] = [
  { value: 'vp9', label: 'VP9 (recommended)' },
  { value: 'vp8', label: 'VP8 (faster)' },
]
const MKV_CODECS: { value: MkvCodec; label: string }[] = [
  { value: 'h264', label: 'H.264 (recommended)' },
  { value: 'vp9', label: 'VP9' },
]

type ButtonOption<T extends string> = {
  value: T
  label: string
  // Shown but not selectable; `reason` says why (tooltip and description).
  unavailable?: boolean
  reason?: string
}

function OptionButtonGroup<T extends string>({
  label,
  options,
  selected,
  disabled,
  describedBy,
  onSelect,
}: {
  label: string
  options: ButtonOption<T>[]
  // null when no option matches (a custom value).
  selected: T | null
  disabled?: boolean
  describedBy?: string
  onSelect: (value: T) => void
}) {
  const selectable = options.filter((option) => !option.unavailable)
  // One tab stop: the selected option, or the first selectable one.
  const tabStop = options.some((option) => option.value === selected)
    ? selected
    : (selectable[0]?.value ?? null)

  // Radio-group keyboard pattern: arrows move and select, skipping options
  // that are unavailable.
  function onKeyDown(event: KeyboardEvent) {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
    if (!forward && !backward) return
    event.preventDefault()
    event.stopPropagation()
    if (disabled || selectable.length === 0) return
    const index = selectable.findIndex((option) => option.value === selected)
    const from = index === -1 ? (forward ? -1 : 0) : index
    const next = selectable[(from + (forward ? 1 : -1) + selectable.length) % selectable.length]
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
      <span class="w-20 text-sm text-slate-500 dark:text-slate-400">{label}</span>
      {options.map((option) => {
        const reasonId =
          option.unavailable && option.reason
            ? `export-${label.toLowerCase()}-${option.value}-reason`
            : undefined
        return (
          <Fragment key={option.value}>
            <button
              type="button"
              role="radio"
              data-value={option.value}
              aria-checked={selected === option.value}
              // Still focusable and hoverable, so the reason can be read.
              aria-disabled={option.unavailable || undefined}
              aria-describedby={reasonId}
              title={option.unavailable ? option.reason : undefined}
              tabIndex={tabStop === option.value ? 0 : -1}
              disabled={disabled}
              class={clsx(
                selected === option.value
                  ? 'bg-violet-500 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100',
                'rounded px-2.5 py-1 text-sm font-medium transition-colors hover:duration-0 focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50'
              )}
              onClick={() => {
                if (!option.unavailable) onSelect(option.value)
              }}
            >
              {option.label}
            </button>
            {reasonId && (
              <span id={reasonId} hidden>
                Unavailable: {option.reason}
              </span>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

type Summary = {
  width: number
  height: number
  duration: number
  // Null while a stream copy is still reading key frames.
  estimate: SizeEstimate | null
  // False when a source bitrate is unknown (or the Advanced layout mixes
  // sources), so presets fall back to fixed per-resolution bitrates.
  sourceRelative: boolean
  // The output codec needs more bits than the source's for the same quality.
  fromMoreEfficientCodec: boolean
  oversizedCanvas: OversizedCanvas | null
  // Set for a stream copy: where the cuts land and what it writes.
  copy: CopyPreview | null
  targetFit: TargetSizeFit | null
  // A smaller standard resolution that gets past the encoder floor (or the
  // smallest one), when the current size cannot shrink any further.
  lowerResolution: Resolution | null
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

const RESOLUTIONS_BY_SIZE = (['1080', '720', '480', '360'] as const).map((value) => ({
  value,
  shortSide: RESOLUTION_SHORT_SIDE[value],
}))

// When the encoder floor sets the size, the first smaller standard
// resolution whose floor sits under the request, else the smallest.
function lowerResolutionFor(
  size: { width: number; height: number },
  estimateAt: (resolution: Resolution) => SizeEstimate | null
): Resolution | null {
  const shortSide = Math.min(size.width, size.height)
  const smaller = RESOLUTIONS_BY_SIZE.filter((option) => option.shortSide < shortSide)
  for (const option of smaller) {
    if (estimateAt(option.value)?.belowEncoderFloor === false) return option.value
  }
  return smaller.at(-1)?.value ?? null
}

// The exact video bytes plus the audio it re-encodes.
function copyEstimate(copy: CopyPreview, audioBitrate: number): SizeEstimate | null {
  if (copy.status !== 'ready') return null
  const bytes = (copy.videoBytes + (audioBitrate * copy.durationSec) / 8) * MUX_OVERHEAD
  return {
    low: bytes,
    expected: bytes,
    high: bytes,
    sourceBytes: null,
    belowEncoderFloor: false,
    encoderFloorBitrate: 0,
  }
}

function sizingOptions(): SizingOptions {
  return { resolution: resolution.value, targetSizeMB: targetSizeMB.value }
}

// Output size, duration, and a size estimate from the same plan the export
// worker builds, so the shown bitrate is the one the encoder is asked for.
function summarize(isAdvanced: boolean): Summary | null {
  const format = exportFormat.value
  const chosenQuality = quality.value
  const fps = framerate.value
  const options = sizingOptions()
  const presetQuality = chosenQuality !== 'target' && chosenQuality !== 'original'
  if (isAdvanced) {
    const jobFor = (choice: Resolution) =>
      buildCompositorJob(advancedSegments.value, format, chosenQuality, fps, {
        ...options,
        resolution: choice,
      })
    const job = jobFor(options.resolution ?? 'original')
    if (!job) return null
    const plan = buildCompositorPlan(job)
    const estimate = estimatePlanBytes(plan)
    return {
      width: plan.outputWidth,
      height: plan.outputHeight,
      duration: projectDuration(advancedSegments.value),
      estimate,
      ...sourceRelation(plan.sizeBasis.sourceEquivalent),
      oversizedCanvas:
        advancedOutputLock.value === null
          ? findOversizedAutoCanvas(visibleAdvancedSegments(advancedSegments.value))
          : null,
      copy: null,
      targetFit: plan.targetFit,
      lowerResolution:
        presetQuality && estimate.belowEncoderFloor
          ? lowerResolutionFor({ width: plan.outputWidth, height: plan.outputHeight }, (choice) => {
              const smaller = jobFor(choice)
              return smaller ? estimatePlanBytes(buildCompositorPlan(smaller)) : null
            })
          : null,
    }
  }
  const jobFor = (choice: Resolution) =>
    buildJob(timeline.value, format, chosenQuality, fps, { ...options, resolution: choice })
  const job = jobFor(options.resolution ?? 'original')
  if (!job || job.slices.length === 0) return null
  const plan = buildEditPlan(job)
  if (job.videoMode === 'copy') {
    const copy = copyPreview.value ?? { status: 'loading' }
    return {
      width: plan.outputWidth,
      height: plan.outputHeight,
      duration: copy.status === 'ready' ? copy.durationSec : plan.sizeBasis.durationSec,
      estimate: copyEstimate(copy, plan.hasAudioOutput ? plan.audioBitrate : 0),
      sourceRelative: true,
      fromMoreEfficientCodec: false,
      oversizedCanvas: null,
      copy,
      targetFit: null,
      lowerResolution: null,
    }
  }
  const estimate = estimatePlanBytes(plan)
  return {
    width: plan.outputWidth,
    height: plan.outputHeight,
    duration: plan.sizeBasis.durationSec,
    estimate,
    ...sourceRelation(plan.sizeBasis.sourceEquivalent),
    oversizedCanvas: null,
    copy: null,
    targetFit: plan.targetFit,
    lowerResolution:
      presetQuality && estimate.belowEncoderFloor
        ? lowerResolutionFor({ width: plan.outputWidth, height: plan.outputHeight }, (choice) => {
            const smaller = jobFor(choice)
            return smaller ? estimatePlanBytes(buildEditPlan(smaller)) : null
          })
        : null,
  }
}

// Only a source-relative estimate can say much about the source, and only a
// clear margin over it is "likely": simple content often lands under the
// predicted encoder floor.
const LARGER_THAN_SOURCE_MARGIN = 1.1

function likelyLargerThanSource(summary: Summary): boolean {
  if (!summary.estimate || summary.copy) return false
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
  const blockers = isAdvanced
    ? ['Advanced mode composites layers onto a canvas, so it always re-encodes.']
    : copyBlockerReasons.value
  const originalUnavailable = blockers.length > 0
  const qualityOptions = QUALITIES.map((option) =>
    option.value === 'original' && originalUnavailable
      ? { ...option, unavailable: true, reason: blockers.join(' ') }
      : option
  )
  const copy = summary?.copy ?? null
  const targetInfeasible = summary?.targetFit?.feasible === false
  const canExport =
    summary !== null && summary.estimate !== null && !targetInfeasible && copy?.status !== 'loading'

  async function handleExport() {
    // Read the live flag: a fast double-click lands before the re-render.
    if (exporting.value || !summary || !summary.estimate || !canExport) return
    const estimate = summary.estimate
    // Capture settings now: the user may change them while the export runs.
    const format = exportFormat.value
    const chosenQuality = quality.value
    const fps = framerate.value
    const options = sizingOptions()
    const filename = makeFilename(format)
    error.value = null
    lastExport.value = null
    info('Export started', {
      mode: appMode.value,
      format,
      quality: chosenQuality,
      fps,
      ...options,
    })
    try {
      const output = isAdvanced
        ? await runAdvancedExport(format, chosenQuality, fps, options)
        : await runExportEngine(timeline.value, format, chosenQuality, fps, options)
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
        estimatedBytes: Math.round(estimate.expected),
        storageName: output.storageName,
      }
      addExportRecord(record)
      lastExport.value = filename
      // Actual against estimate, to recalibrate the model on real encoders.
      info('Export finished', {
        filename,
        size: record.size,
        estimatedBytes: record.estimatedBytes,
        actualOverEstimate: Number((record.size / estimate.expected).toFixed(2)),
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
  // A copy does no encoding work, so the encode cost warning does not apply.
  const feasibility =
    summary && !copy
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
          options={qualityOptions}
          selected={quality.value}
          disabled={busy}
          describedBy="export-quality-hint"
          onSelect={(value) => (quality.value = value)}
        />
        <p id="export-quality-hint" class="text-sm text-slate-500 sm:pl-22 dark:text-slate-400">
          {summary && !summary.sourceRelative
            ? QUALITY_HINTS[quality.value].fixed
            : QUALITY_HINTS[quality.value].relative}
          {summary?.fromMoreEfficientCodec &&
            (quality.value === 'medium' || quality.value === 'low') &&
            CONVERSION_HINT}
          {quality.value === 'original' && originalUnavailable && (
            <>
              {' '}
              <span class="font-medium text-amber-700 dark:text-amber-300">
                Not available here: {blockers.join(' ')} Exporting at High instead.
              </span>
            </>
          )}
        </p>
        {quality.value === 'target' && <TargetSizeRow disabled={busy} />}
        <OptionButtonGroup
          label="Resolution"
          options={RESOLUTIONS}
          selected={resolution.value}
          disabled={busy}
          onSelect={(value) => (resolution.value = value)}
        />
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
            disabled={!canExport || !webcodecsAvailable}
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
                {summary.width}×{summary.height} · {formatTimecode(summary.duration)} ·{' '}
                {summary.estimate === null ? (
                  copy?.status === 'loading' ? (
                    'Reading key frames…'
                  ) : (
                    'size unknown'
                  )
                ) : copy ? (
                  <>~{formatSize(summary.estimate.expected)} · video copied as is</>
                ) : (
                  <>
                    ~{formatSize(summary.estimate.expected)} (
                    {formatSizeRange(summary.estimate.low, summary.estimate.high)})
                    {summary.estimate.sourceBytes !== null && (
                      <> · source {formatSize(summary.estimate.sourceBytes)}</>
                    )}
                  </>
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
          {copy && <CopyShiftNote copy={copy} />}
          {summary?.targetFit && <TargetFitNote summary={summary} fit={summary.targetFit} />}
          {summary?.estimate && (likelyLargerThanSource(summary) || summary.lowerResolution) && (
            <div class="flex flex-wrap items-start gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              <Info class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p class="min-w-48 flex-1">
                {!likelyLargerThanSource(summary)
                  ? `At ${summary.width}×${summary.height} the encoder cannot go below about ${formatKbps(summary.estimate.encoderFloorBitrate)} of video, so this quality will not make the file any smaller.`
                  : summary.estimate.belowEncoderFloor
                    ? `Likely larger than the source. The source is more compressed than the encoder can go at ${summary.width}×${summary.height} (about ${formatKbps(summary.estimate.encoderFloorBitrate)} of video), so a lower quality will not shrink it much.`
                    : 'Likely larger than the source. Pick a lower quality for a smaller file.'}
                {summary.lowerResolution && ' A lower resolution makes a smaller file.'}
              </p>
              {summary.lowerResolution && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => (resolution.value = summary.lowerResolution!)}
                  class="shrink-0 rounded bg-amber-100 px-2.5 py-1 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-200 hover:duration-0 focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-amber-900/40 dark:text-amber-200 dark:hover:bg-amber-900/60"
                >
                  Use {summary.lowerResolution}p
                </button>
              )}
            </div>
          )}
          {summary?.oversizedCanvas && (
            <div class="flex flex-wrap items-start gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              <Info class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p class="min-w-48 flex-1">
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

// Preset sizes plus a custom field; a custom value leaves no preset checked.
function TargetSizeRow({ disabled }: { disabled: boolean }) {
  const current = targetSizeMB.value
  const preset = TARGET_SIZE_PRESETS_MB.includes(current) ? String(current) : null
  return (
    <div class="flex flex-wrap items-center gap-2">
      <OptionButtonGroup
        label="Target"
        options={TARGET_SIZES}
        selected={preset}
        disabled={disabled}
        onSelect={(value) => (targetSizeMB.value = Number(value))}
      />
      <label class="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
        <span class="sr-only">Custom target size in megabytes</span>
        <input
          type="number"
          inputMode="decimal"
          min={TARGET_SIZE_MIN_MB}
          max={TARGET_SIZE_MAX_MB}
          step="any"
          value={current}
          disabled={disabled}
          onChange={(event) => {
            const value = Number((event.currentTarget as HTMLInputElement).value)
            if (
              Number.isFinite(value) &&
              value >= TARGET_SIZE_MIN_MB &&
              value <= TARGET_SIZE_MAX_MB
            ) {
              targetSizeMB.value = value
            }
          }}
          class="w-20 rounded border border-slate-300 bg-white/70 px-2 py-1 text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:outline-none disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800/70"
        />
        MB
      </label>
    </div>
  )
}

function TargetFitNote({ summary, fit }: { summary: Summary; fit: TargetSizeFit }) {
  if (!fit.feasible) {
    return (
      <div
        role="alert"
        class="flex items-start gap-2 rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
      >
        <AlertTriangle class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          {formatSize(targetSizeMB.value * 1_000_000)} is too small for{' '}
          {formatTimecode(summary.duration)} of video, even at {fit.size.width}×{fit.size.height}{' '}
          and {Math.round(fit.frameRate)} fps. Pick at least {formatSize(fit.minimumBytes)}.
        </p>
      </div>
    )
  }
  if (!fit.frameRateLowered && !fit.shrunk) return null
  return (
    <p class="text-sm text-slate-500 dark:text-slate-400">
      To fit {formatSize(targetSizeMB.value * 1_000_000)}: {fit.size.width}×{fit.size.height}
      {fit.frameRateLowered && <> at {Math.round(fit.frameRate)} fps</>}, about{' '}
      {formatKbps(fit.videoBitrate)} of video.
    </p>
  )
}

function CopyShiftNote({ copy }: { copy: CopyPreview }) {
  if (copy.status === 'loading') {
    return (
      <p role="status" class="text-sm text-slate-500 dark:text-slate-400">
        Reading key frames…
      </p>
    )
  }
  if (copy.status === 'failed') {
    return (
      <p class="text-sm text-amber-700 dark:text-amber-300">
        The key frames could not be read here, so the cut points and size are unknown. The export
        still copies the video.
      </p>
    )
  }
  const shifted = timeline.value
    .map((segment, index) => ({ segment, index, shift: copy.shifts.get(segment.id) }))
    .filter((entry) => entry.shift && Math.abs(entry.shift.shiftSec) >= 0.0005)
  const large = copy.maxShiftSec > LARGE_SNAP_SHIFT_SEC
  return (
    <div
      class={clsx(
        'flex items-start gap-2 rounded-md p-2 text-sm',
        large
          ? 'bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300'
          : 'bg-slate-100/60 text-slate-600 dark:bg-slate-800/40 dark:text-slate-300'
      )}
    >
      <Info class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        {shifted.length === 0 ? (
          <p>Every cut is on a key frame, so the export starts exactly where the segments do.</p>
        ) : (
          <>
            <p>
              {large
                ? `A cut moves back more than ${LARGE_SNAP_SHIFT_SEC} s to reach a key frame, so the export includes footage before it. Pick a quality preset for an exact cut.`
                : 'Cuts move back to the key frame before them (dashed line on the timeline):'}
            </p>
            <ul class="mt-1 grid gap-0.5 tabular-nums">
              {shifted.map(({ segment, index, shift }) => (
                <li key={segment.id}>
                  Segment {index + 1}: starts at {formatPreciseTime(shift!.snappedStart)},{' '}
                  {shift!.shiftSec >= 0
                    ? `${shift!.shiftSec.toFixed(2)} s earlier`
                    : `${(-shift!.shiftSec).toFixed(2)} s later`}
                </li>
              ))}
            </ul>
          </>
        )}
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
