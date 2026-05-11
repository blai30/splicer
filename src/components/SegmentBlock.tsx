import clsx from 'clsx/lite'
import { useEffect, useRef } from 'preact/hooks'

import { WaveformView } from '@/components/WaveformView'
import { formatTime } from '@/lib/format'
import { clips, playheadTime, selectedSegmentId, timeline, videoEl } from '@/lib/store'
import { GAP_PX, clipColor, dragState, getSegmentStartX, pxPerSec } from '@/lib/store'
import {
  clampPlayheadForSegment,
  findDropIndexAtTrackX,
  updateSegmentEndTime,
  updateSegmentStartTime,
} from '@/lib/timelineDomain'
import type { Segment } from '@/lib/types'
import { ensureClipWaveform } from '@/lib/videoImport'

export function SegmentBlock({ seg, isDragging }: { seg: Segment; isDragging?: boolean }) {
  const clip = clips.value.find((c) => c.id === seg.clipId)
  const dur = seg.endTime - seg.startTime
  const width = dur * pxPerSec.value
  const isSelected = selectedSegmentId.value === seg.id
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!clip) return
    if ((clip.waveformPeaks?.length ?? 0) > 0) return
    void ensureClipWaveform(clip.id)
  }, [clip?.id, clip?.waveformPeaks?.length])

  function onTrimPointerDown(side: 'left' | 'right') {
    return (e: PointerEvent) => {
      e.stopPropagation()
      const handle = side === 'left' ? leftRef.current! : rightRef.current!
      handle.setPointerCapture(e.pointerId)
      const startX = e.clientX
      const startTime = side === 'left' ? seg.startTime : seg.endTime

      function onMove(mv: PointerEvent) {
        const dt = (mv.clientX - startX) / pxPerSec.value
        const clipDur = clips.value.find((c) => c.id === seg.clipId)?.duration ?? seg.endTime
        if (side === 'left') {
          timeline.value = updateSegmentStartTime(timeline.value, seg.id, startTime + dt)
        } else {
          timeline.value = updateSegmentEndTime(timeline.value, seg.id, startTime + dt, clipDur)
        }
      }

      function onUp() {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
      }

      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
    }
  }

  function onBodyPointerDown(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement
    const trackEl = el.closest('[data-track]') as HTMLElement | null
    if (!trackEl) return
    e.stopPropagation()
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    let moved = false

    function onMove(mv: PointerEvent) {
      if (!moved && Math.abs(mv.clientX - startX) > 8) {
        moved = true
      }
      if (moved && trackEl) {
        const rect = trackEl.getBoundingClientRect()
        const x = mv.clientX - rect.left + trackEl.scrollLeft - GAP_PX
        const dropIdx = findDropIndexAtTrackX(timeline.value, x, pxPerSec.value, GAP_PX)
        dragState.value = { segId: seg.id, dropIndex: dropIdx }
      }
    }

    function onUp() {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      if (moved && dragState.value) {
        const fromIdx = timeline.value.findIndex((s) => s.id === seg.id)
        const toIdx = dragState.value.dropIndex
        if (fromIdx !== toIdx && fromIdx + 1 !== toIdx) {
          const segs = [...timeline.value]
          const [removed] = segs.splice(fromIdx, 1)
          const adjusted = toIdx > fromIdx ? toIdx - 1 : toIdx
          segs.splice(adjusted, 0, removed)
          timeline.value = segs
        }
        dragState.value = null
      } else if (!moved) {
        selectedSegmentId.value = seg.id
        if (trackEl) {
          const rect = trackEl.getBoundingClientRect()
          const x = e.clientX - rect.left + trackEl.scrollLeft
          const segStartX = getSegmentStartX(seg.id)
          const t = seg.startTime + Math.max(0, x - segStartX) / pxPerSec.value
          const clamped = clampPlayheadForSegment(seg, t)
          playheadTime.value = clamped
          const v = videoEl.current
          if (v) v.currentTime = clamped
        }
      }
    }

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  return (
    <div
      data-segment
      class={clsx(
        'relative flex h-14 shrink-0 cursor-grab items-center overflow-hidden rounded border select-none',
        isSelected
          ? 'border-violet-400 ring-1 ring-violet-400'
          : 'border-black/10 dark:border-white/10',
        clipColor(seg.clipId),
        isDragging && 'opacity-40'
      )}
      style={{ width: `${width}px` }}
      onPointerDown={onBodyPointerDown}
    >
      {clip && (
        <WaveformView
          peaks={clip.waveformPeaks ?? []}
          clipDuration={clip.duration}
          segmentStart={seg.startTime}
          segmentEnd={seg.endTime}
          class="absolute inset-0 h-full w-full opacity-80"
        />
      )}
      <span class="relative z-10 mt-1 self-start truncate px-2 text-sm font-medium text-white">
        {clip?.name ?? 'Clip'}
        {seg.muted && <span class="ml-1 opacity-70">🔇</span>}
      </span>
      <span class="relative z-10 ml-auto shrink-0 self-end pr-2 text-sm text-white/70">
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
