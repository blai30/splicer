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

const activeBtn =
  'rounded bg-violet-500 px-2.5 py-1 text-sm font-medium text-white transition-colors'
const inactiveBtn =
  'rounded px-2.5 py-1 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100'

function OptionButtonGroup<T extends string>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string
  options: { value: T; label: string }[]
  selected: T
  onSelect: (v: T) => void
}) {
  return (
    <div class="flex flex-wrap items-center gap-2">
      <span class="w-14 text-sm text-slate-500 dark:text-slate-400">{label}</span>
      {options.map((o) => (
        <button
          key={o.value}
          class={clsx(selected === o.value ? activeBtn : inactiveBtn)}
          onClick={() => onSelect(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
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

  const formats: { value: ExportFormat; label: string }[] = [
    { value: 'mp4', label: 'MP4' },
    { value: 'webm', label: 'WEBM' },
    { value: 'mkv', label: 'MKV' },
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
  const progressPct = Math.round(ffmpegProgress.value * 100)

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
          onSelect={(v) => {
            exportFormat.value = v
          }}
        />
        <OptionButtonGroup
          label="Quality"
          options={qualities}
          selected={quality.value}
          onSelect={(v) => {
            quality.value = v
          }}
        />
        <OptionButtonGroup
          label="FPS"
          options={framerates}
          selected={framerate.value}
          onSelect={(v) => {
            framerate.value = v
          }}
        />
      </div>

      <div class="flex flex-col gap-2 border-t border-slate-200/60 pt-2 sm:flex-row sm:items-center dark:border-slate-700/60">
        <div class="min-w-0 flex-1">
          {exporting.value && !ffmpegReady.value && (
            <span class="text-sm text-slate-500 dark:text-slate-400">Initializing FFmpeg…</span>
          )}
          {exporting.value && ffmpegReady.value && (
            <div class="flex items-center gap-2">
              <div class="h-1.5 flex-1 overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
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
            class="inline-flex h-10 items-center justify-center gap-1.5 rounded bg-slate-100 px-4 text-base font-semibold text-slate-600 transition-colors hover:bg-red-100 hover:text-red-600 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:bg-red-900/30 dark:hover:text-red-400"
          >
            <X class="h-4 w-4" />
            Cancel Export
          </button>
        ) : (
          <button
            onClick={handleExport}
            onMouseEnter={initFFmpeg}
            disabled={!hasSegments}
            class="inline-flex h-10 items-center justify-center gap-2 rounded bg-violet-500 px-4 text-base font-semibold text-white transition-colors hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CirclePlay class="h-4 w-4" />
            Export Video
          </button>
        )}
      </div>
    </div>
  )
}
