import clsx from 'clsx/lite'
import { useEffect, useRef } from 'preact/hooks'

import { WaveformView } from '@/components/WaveformView'
import { formatTime } from '@/lib/format'
import { seek } from '@/lib/playback'
import { selectedSegmentId, timeline, getClipById, clips } from '@/lib/store'
import { GAP_PX, clipColor, dragState, pxPerSec } from '@/lib/store'
import { createRafThrottler } from '@/lib/timelineDomain'
import {
  clampPlayheadForSegment,
  findDropIndexAtTrackX,
  updateSegmentEndTime,
  updateSegmentStartTime,
} from '@/lib/timelineDomain'
import type { Segment } from '@/lib/types'
import { ensureClipWaveform } from '@/lib/videoImport'

export function SegmentBlock({
  segment,
  isDragging,
  startX,
  width,
}: {
  segment: Segment
  isDragging?: boolean
  startX: number
  width: number
}) {
  const clip = clips.value.find((clip) => clip.id === segment.clipId) ?? getClipById(segment.clipId)
  const segmentDuration = segment.endTime - segment.startTime
  const isSelected = selectedSegmentId.value === segment.id
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
      const startClientX = e.clientX
      const startTime = side === 'left' ? segment.startTime : segment.endTime

      const throttler = createRafThrottler()

      function onMove(mv: PointerEvent) {
        const dt = (mv.clientX - startClientX) / pxPerSec.value
        const clipDur = getClipById(segment.clipId)?.duration ?? segment.endTime
        throttler.queue(() => {
          if (side === 'left') {
            timeline.value = updateSegmentStartTime(timeline.value, segment.id, startTime + dt)
          } else {
            timeline.value = updateSegmentEndTime(
              timeline.value,
              segment.id,
              startTime + dt,
              clipDur
            )
          }
        })
      }

      function onUp() {
        throttler.cancel()
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
    const startClientX = e.clientX
    let moved = false

    function onMove(mv: PointerEvent) {
      if (!moved && Math.abs(mv.clientX - startClientX) > 8) {
        moved = true
      }
      if (moved && trackEl) {
        const rect = trackEl.getBoundingClientRect()
        const x = mv.clientX - rect.left + trackEl.scrollLeft - GAP_PX
        const dropIndex = findDropIndexAtTrackX(timeline.value, x, pxPerSec.value, GAP_PX)
        dragState.value = { segId: segment.id, dropIndex }
      }
    }

    function onUp() {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      if (moved && dragState.value) {
        const segmentId = segment.id
        const fromIndex = timeline.value.findIndex((s) => s.id === segmentId)
        const toIndex = dragState.value.dropIndex
        if (fromIndex !== toIndex && fromIndex + 1 !== toIndex) {
          const segments = [...timeline.value]
          const [removed] = segments.splice(fromIndex, 1)
          const adjusted = toIndex > fromIndex ? toIndex - 1 : toIndex
          segments.splice(adjusted, 0, removed)
          timeline.value = segments
        }
        dragState.value = null
      } else if (!moved) {
        selectedSegmentId.value = segment.id
        if (trackEl) {
          const rect = trackEl.getBoundingClientRect()
          const x = e.clientX - rect.left + trackEl.scrollLeft
          const segmentStartX = startX
          const t = segment.startTime + Math.max(0, x - segmentStartX) / pxPerSec.value
          const clamped = clampPlayheadForSegment(segment, t)
          seek(clamped)
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
        clipColor(segment.clipId),
        isDragging && 'opacity-40'
      )}
      style={{ width: `${width}px` }}
      onPointerDown={onBodyPointerDown}
    >
      {clip && (
        <WaveformView
          peaks={clip.waveformPeaks ?? []}
          clipDuration={clip.duration}
          segmentStart={segment.startTime}
          segmentEnd={segment.endTime}
          class="absolute inset-0 h-full w-full opacity-80"
        />
      )}
      <span class="relative z-10 mt-1 self-start truncate px-2 text-sm font-medium text-white">
        {clip?.name ?? 'Clip'}
        {segment.muted && <span class="ml-1">🔇</span>}
      </span>
      <span class="relative z-10 ml-auto shrink-0 self-end pr-2 text-sm text-white/70">
        {formatTime(segmentDuration)}
      </span>
      <div
        ref={leftRef}
        class="absolute top-0 bottom-0 left-0 z-20 w-2 cursor-ew-resize bg-white/40 transition-colors hover:bg-white/70 hover:duration-0"
        onPointerDown={onTrimPointerDown('left')}
        onClick={(e) => e.stopPropagation()}
      />
      <div
        ref={rightRef}
        class="absolute top-0 right-0 bottom-0 z-20 w-2 cursor-ew-resize bg-white/40 transition-colors hover:bg-white/70 hover:duration-0"
        onPointerDown={onTrimPointerDown('right')}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
