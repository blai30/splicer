import { useRef } from 'preact/hooks'
import { clips, playheadTime, selectedSegmentId, timeline } from '../lib/store'
import type { Segment } from '../lib/types'

const PX_PER_SEC = 80

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function clipColor(clipId: string): string {
  const colors = [
    'bg-emerald-500',
    'bg-teal-500',
    'bg-cyan-500',
    'bg-green-500',
    'bg-sky-500',
  ]
  // Deterministic color per clipId
  let hash = 0
  for (let i = 0; i < clipId.length; i++) hash = (hash * 31 + clipId.charCodeAt(i)) | 0
  return colors[Math.abs(hash) % colors.length]
}

function SegmentBlock({ seg }: { seg: Segment }) {
  const clip = clips.value.find((c) => c.id === seg.clipId)
  const duration = seg.endTime - seg.startTime
  const width = duration * PX_PER_SEC
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
        const dx = mv.clientX - startX
        const dt = dx / PX_PER_SEC
        const fullClip = clips.value.find((c) => c.id === seg.clipId)
        const clipDuration = fullClip?.duration ?? seg.endTime

        timeline.value = timeline.value.map((s) => {
          if (s.id !== seg.id) return s
          if (side === 'left') {
            const newStart = Math.max(0, Math.min(startTime + dt, s.endTime - 0.1))
            return { ...s, startTime: newStart }
          } else {
            const newEnd = Math.min(clipDuration, Math.max(startTime + dt, s.startTime + 0.1))
            return { ...s, endTime: newEnd }
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
      class={`relative flex items-center h-14 rounded cursor-pointer select-none shrink-0 overflow-hidden group ${
        isSelected ? 'ring-2 ring-emerald-400' : 'ring-1 ring-black/20'
      } ${clipColor(seg.clipId)}`}
      style={{ width: `${width}px` }}
      onClick={onSelect}
    >
      {/* Thumbnail strip */}
      {clip?.thumbnail && (
        <img
          src={clip.thumbnail}
          alt={clip.name}
          class="absolute inset-0 w-full h-full object-cover opacity-30"
          draggable={false}
        />
      )}

      {/* Label */}
      <span class="relative z-10 px-2 text-xs font-medium text-white truncate">
        {clip?.name ?? 'Clip'}
        {seg.muted && <span class="ml-1 opacity-70">🔇</span>}
      </span>

      {/* Duration */}
      <span class="relative z-10 ml-auto pr-2 text-xs text-white/70 shrink-0">
        {formatTime(duration)}
      </span>

      {/* Left trim handle */}
      <div
        ref={leftRef}
        class="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/40 hover:bg-white/70 transition-colors z-20"
        onPointerDown={onTrimPointerDown('left')}
        onClick={(e) => e.stopPropagation()}
      />
      {/* Right trim handle */}
      <div
        ref={rightRef}
        class="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/40 hover:bg-white/70 transition-colors z-20"
        onPointerDown={onTrimPointerDown('right')}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}

export function Timeline() {
  const totalDuration = timeline.value.reduce((acc, s) => acc + (s.endTime - s.startTime), 0)
  const playheadLeft = playheadTime.value * PX_PER_SEC

  return (
    <div class="flex flex-col bg-mist-100 dark:bg-mist-800 border-t border-mist-200 dark:border-mist-700 shrink-0" style={{ height: '140px' }}>
      <div class="px-3 py-1.5 flex items-center gap-2 border-b border-mist-200 dark:border-mist-700">
        <span class="text-xs font-semibold uppercase tracking-wider text-mist-500 dark:text-mist-400">Timeline</span>
        <span class="text-xs text-mist-400 dark:text-mist-500 ml-auto">{formatTime(totalDuration)}</span>
      </div>

      <div class="flex-1 overflow-x-auto overflow-y-hidden relative">
        {timeline.value.length === 0 ? (
          <div class="flex items-center justify-center h-full">
            <p class="text-xs text-mist-400 dark:text-mist-500">Click a clip to add it to the timeline</p>
          </div>
        ) : (
          <div class="flex items-center gap-1 h-full px-3 relative">
            {timeline.value.map((seg) => (
              <SegmentBlock key={seg.id} seg={seg} />
            ))}
            {/* Playhead */}
            <div
              class="absolute top-0 bottom-0 w-0.5 bg-emerald-400 pointer-events-none z-30"
              style={{ left: `${12 + playheadLeft}px` }}
            >
              <div class="w-2 h-2 bg-emerald-400 rounded-full -translate-x-0.75 -translate-y-1" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
