import { useSignal } from '@preact/signals'
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Scissors,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-preact'
import { useRef } from 'preact/hooks'

import { cutAtPlayhead, deleteSegment, setInPoint, setOutPoint, toggleMute } from '@/lib/actions'
import { clips, playheadTime, selectedSegmentId, timeline, videoEl } from '@/lib/store'
import type { Clip, Segment } from '@/lib/types'

const PX_PER_SEC = 80
const GAP_PX = 4 // gap-1
const PADDING_PX = 12 // px-3

const ACCEPTED = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
]

function isVideoFile(file: File): boolean {
  return ACCEPTED.includes(file.type) || /\.(mp4|webm|mov|avi|mkv)$/i.test(file.name)
}

function getVideoMetadata(
  url: string
): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () =>
      resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight })
    v.src = url
  })
}

function captureThumbnail(url: string): Promise<string> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.src = url
    v.currentTime = 0.5
    v.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 160
      canvas.height = 90
      canvas.getContext('2d')!.drawImage(v, 0, 0, 160, 90)
      resolve(canvas.toDataURL('image/jpeg', 0.6))
    }
  })
}

async function importAndAppend(file: File): Promise<void> {
  if (!isVideoFile(file)) return
  const objectUrl = URL.createObjectURL(file)
  const { duration, width, height } = await getVideoMetadata(objectUrl)
  const thumbnail = await captureThumbnail(objectUrl)
  const clip: Clip = {
    id: crypto.randomUUID(),
    file,
    name: file.name.replace(/\.[^.]+$/, ''),
    duration,
    width,
    height,
    objectUrl,
    thumbnail,
  }
  clips.value = [...clips.value, clip]
  const seg: Segment = {
    id: crypto.randomUUID(),
    clipId: clip.id,
    startTime: 0,
    endTime: duration,
    muted: false,
  }
  timeline.value = [...timeline.value, seg]
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function clipColor(clipId: string): string {
  const colors = ['bg-violet-500', 'bg-teal-500', 'bg-cyan-500', 'bg-green-500', 'bg-sky-500']
  let hash = 0
  for (let i = 0; i < clipId.length; i++) hash = (hash * 31 + clipId.charCodeAt(i)) | 0
  return colors[Math.abs(hash) % colors.length]
}

function getSegmentStartX(segId: string): number {
  let x = PADDING_PX
  for (const seg of timeline.value) {
    if (seg.id === segId) return x
    x += (seg.endTime - seg.startTime) * PX_PER_SEC + GAP_PX
  }
  return PADDING_PX
}

function SegmentBlock({ seg }: { seg: Segment }) {
  const clip = clips.value.find((c) => c.id === seg.clipId)
  const dur = seg.endTime - seg.startTime
  const width = dur * PX_PER_SEC
  const isSelected = selectedSegmentId.value === seg.id
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)

  function onSelect() {
    selectedSegmentId.value = seg.id
  }

  function onTrimPointerDown(side: 'left' | 'right') {
    return (e: PointerEvent) => {
      e.stopPropagation()
      const handle = side === 'left' ? leftRef.current! : rightRef.current!
      handle.setPointerCapture(e.pointerId)
      const startX = e.clientX
      const startTime = side === 'left' ? seg.startTime : seg.endTime

      function onMove(mv: PointerEvent) {
        const dt = (mv.clientX - startX) / PX_PER_SEC
        const clipDur = clips.value.find((c) => c.id === seg.clipId)?.duration ?? seg.endTime
        timeline.value = timeline.value.map((s) => {
          if (s.id !== seg.id) return s
          if (side === 'left') {
            return { ...s, startTime: Math.max(0, Math.min(startTime + dt, s.endTime - 0.1)) }
          } else {
            return { ...s, endTime: Math.min(clipDur, Math.max(startTime + dt, s.startTime + 0.1)) }
          }
        })
      }

      function onUp() {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
      }

      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
    }
  }

  return (
    <div
      class={`relative flex h-14 shrink-0 cursor-pointer items-center overflow-hidden rounded select-none ${
        isSelected ? 'ring-2 ring-violet-400' : 'ring-1 ring-black/20'
      } ${clipColor(seg.clipId)}`}
      style={{ width: `${width}px` }}
      onClick={onSelect}
    >
      {clip?.thumbnail && (
        <img
          src={clip.thumbnail}
          alt={clip.name}
          class="absolute inset-0 h-full w-full object-cover opacity-30"
          draggable={false}
        />
      )}
      <span class="relative z-10 truncate px-2 text-xs font-medium text-white">
        {clip?.name ?? 'Clip'}
        {seg.muted && <span class="ml-1 opacity-70">🔇</span>}
      </span>
      <span class="relative z-10 ml-auto shrink-0 pr-2 text-xs text-white/70">
        {formatTime(dur)}
      </span>
      <div
        ref={leftRef}
        class="absolute top-0 bottom-0 left-0 z-20 w-2 cursor-ew-resize bg-white/40 transition-colors hover:bg-white/70"
        onPointerDown={onTrimPointerDown('left')}
        onClick={(e) => e.stopPropagation()}
      />
      <div
        ref={rightRef}
        class="absolute top-0 right-0 bottom-0 z-20 w-2 cursor-ew-resize bg-white/40 transition-colors hover:bg-white/70"
        onPointerDown={onTrimPointerDown('right')}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}

export function Timeline() {
  const trackRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const totalDuration = timeline.value.reduce((acc, s) => acc + (s.endTime - s.startTime), 0)
  const draggingOver = useSignal(false)

  const activeSegId = selectedSegmentId.value ?? timeline.value[0]?.id
  const activeSeg = timeline.value.find((s) => s.id === activeSegId)
  const playheadLeft = activeSeg
    ? getSegmentStartX(activeSeg.id) + (playheadTime.value - activeSeg.startTime) * PX_PER_SEC
    : PADDING_PX

  function onTrackPointerDown(e: PointerEvent) {
    if (!trackRef.current) return
    if (timeline.value.length === 0) return
    if ((e.target as HTMLElement).closest('[data-playhead]')) return
    const trackEl = trackRef.current

    function seekFromPointer(ev: PointerEvent) {
      const rect = trackEl.getBoundingClientRect()
      const x = ev.clientX - rect.left + trackEl.scrollLeft
      let segX = PADDING_PX
      for (const seg of timeline.value) {
        const segWidth = (seg.endTime - seg.startTime) * PX_PER_SEC
        if (x >= segX && x <= segX + segWidth) {
          const t = seg.startTime + (x - segX) / PX_PER_SEC
          selectedSegmentId.value = seg.id
          playheadTime.value = t
          const v = videoEl.current
          if (v) v.currentTime = t
          return
        }
        segX += segWidth + GAP_PX
      }
    }

    seekFromPointer(e)
    trackEl.setPointerCapture(e.pointerId)

    function onMove(mv: PointerEvent) {
      seekFromPointer(mv)
    }
    function onUp() {
      trackEl.removeEventListener('pointermove', onMove)
      trackEl.removeEventListener('pointerup', onUp)
    }
    trackEl.addEventListener('pointermove', onMove)
    trackEl.addEventListener('pointerup', onUp)
  }

  function onPlayheadPointerDown(e: PointerEvent) {
    if (!activeSeg || !trackRef.current) return
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const segStartX = getSegmentStartX(activeSeg.id)
    const trackEl = trackRef.current

    function onMove(mv: PointerEvent) {
      const rect = trackEl.getBoundingClientRect()
      const x = mv.clientX - rect.left + trackEl.scrollLeft
      const t = Math.max(
        activeSeg!.startTime,
        Math.min(activeSeg!.endTime, activeSeg!.startTime + (x - segStartX) / PX_PER_SEC)
      )
      playheadTime.value = t
      const v = videoEl.current
      if (v) v.currentTime = t
    }
    function onUp() {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  function onDragOver(e: DragEvent) {
    if ([...(e.dataTransfer?.items ?? [])].some((item) => item.kind === 'file')) {
      e.preventDefault()
      draggingOver.value = true
    }
  }

  function onDragLeave(e: DragEvent) {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      draggingOver.value = false
    }
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault()
    draggingOver.value = false
    const files = Array.from(e.dataTransfer?.files ?? [])
    for (const f of files) await importAndAppend(f)
  }

  async function onFileInputChange(e: Event) {
    const files = Array.from((e.target as HTMLInputElement).files ?? [])
    for (const f of files) await importAndAppend(f)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const isEmpty = timeline.value.length === 0
  const seg = timeline.value.find((s) => s.id === selectedSegmentId.value)
  const disabled = !seg
  const toolBtn =
    'flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'

  return (
    <div
      class={`relative flex h-48 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white/95 shadow-lg shadow-slate-900/10 backdrop-blur transition-colors dark:border-slate-700/70 dark:bg-slate-900/95 dark:shadow-black/30 ${
        draggingOver.value ? 'ring-2 ring-violet-400' : ''
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onWheel={(e: WheelEvent) => {
        if (!trackRef.current || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
        e.preventDefault()
        trackRef.current.scrollLeft += e.deltaY
      }}
    >
      {/* Header */}
      <div class="flex shrink-0 items-start gap-2.5 px-4 pt-3 pb-2">
        <span class="pt-1 text-xs font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
          Timeline
        </span>
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <button
            class={toolBtn}
            disabled={disabled}
            onClick={setInPoint}
            title="Set in-point (I)"
          >
            <ArrowLeftToLine class="h-3.5 w-3.5" />
            In
          </button>

          <button
            class={toolBtn}
            disabled={disabled}
            onClick={setOutPoint}
            title="Set out-point (O)"
          >
            <ArrowRightToLine class="h-3.5 w-3.5" />
            Out
          </button>

          <button
            class={toolBtn}
            disabled={disabled}
            onClick={cutAtPlayhead}
            title="Split at playhead (C)"
          >
            <Scissors class="h-3.5 w-3.5" />
            Cut
          </button>

          <button
            class={toolBtn}
            disabled={disabled}
            onClick={toggleMute}
            title="Toggle mute"
          >
            {seg?.muted ? <VolumeX class="h-3.5 w-3.5" /> : <Volume2 class="h-3.5 w-3.5" />}
            {seg?.muted ? 'Unmute' : 'Mute'}
          </button>

          <button
            class="flex items-center gap-1.5 rounded-md bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-600 transition-colors hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-red-900/40 dark:text-red-400 dark:hover:bg-red-900/60"
            disabled={disabled}
            onClick={deleteSegment}
            title="Delete segment"
          >
            <Trash2 class="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
        <span class="ml-auto text-xs text-slate-400 dark:text-slate-500">
          {formatTime(totalDuration)}
        </span>
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        class="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden"
        onPointerDown={onTrackPointerDown}
      >
        {isEmpty ? (
          <div
            class="flex h-full cursor-pointer items-center justify-center gap-2 px-4 pb-5"
            onClick={() => fileInputRef.current?.click()}
          >
            <div
              class={`flex min-h-24 w-full max-w-lg items-center justify-center gap-2 rounded-xl border-[3px] border-dashed px-5 py-4 text-center transition-colors ${
                draggingOver.value
                  ? 'border-violet-500 bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300'
                  : 'border-slate-300 bg-slate-50 text-slate-500 dark:border-slate-600 dark:bg-slate-800/30 dark:text-slate-400'
              }`}
            >
              {draggingOver.value ? (
                <p class="text-sm font-semibold">Drop to import</p>
              ) : (
                <>
                  <Upload class="h-4 w-4" />
                  <p class="text-sm">Click or drop video files to import</p>
                </>
              )}
            </div>
          </div>
        ) : (
          <div class="relative flex h-full items-start gap-1 px-4 pt-12">
            {timeline.value.map((seg) => (
              <SegmentBlock key={seg.id} seg={seg} />
            ))}
            <div
              data-playhead
              class="absolute top-0 bottom-0 z-30 w-3 -translate-x-1/2 cursor-ew-resize"
              style={{ left: `${playheadLeft}px` }}
              onPointerDown={onPlayheadPointerDown}
            >
              <div class="pointer-events-none absolute inset-x-0 top-0 bottom-0 flex justify-center">
                <div class="h-full w-0.5 bg-violet-400" />
              </div>
              <div class="pointer-events-none absolute top-0 left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1 rounded-full bg-violet-400" />
            </div>
          </div>
        )}
      </div>

      {/* Drop overlay when timeline has content */}
      {draggingOver.value && !isEmpty && (
        <div class="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl border-2 border-dashed border-violet-400 bg-violet-50/60 dark:bg-violet-950/40">
          <p class="text-sm font-medium text-violet-500">Drop to append</p>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,.mp4,.webm,.mov,.avi,.mkv"
        multiple
        class="hidden"
        onChange={onFileInputChange}
      />
    </div>
  )
}
