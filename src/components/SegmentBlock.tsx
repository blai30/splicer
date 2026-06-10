import clsx from 'clsx/lite'
import { useEffect, useRef } from 'preact/hooks'

import { WaveformView } from '@/components/WaveformView'
import { formatTime } from '@/lib/format'
import { seek } from '@/lib/playback'
import { selectedSegmentId, timeline, getClipById, clips } from '@/lib/store'
import { GAP_PX, clipColor, dragState, pxPerSec } from '@/lib/store'
import { createRafThrottler } from '@/lib/timelineDomain'
import { clampPlayheadForSegment, findDropIndexAtTrackX } from '@/lib/timelineDomain'
import {
  beginGesture,
  reorderSegment,
  trimSegmentEnd,
  trimSegmentStart,
} from '@/lib/timelineEditing'
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
    return (event: PointerEvent) => {
      event.stopPropagation()
      const handle = side === 'left' ? leftRef.current! : rightRef.current!
      handle.setPointerCapture(event.pointerId)
      const startClientX = event.clientX
      const startTime = side === 'left' ? segment.startTime : segment.endTime

      // One undo history entry per trim gesture, not per pointer move.
      beginGesture()
      const throttler = createRafThrottler()

      function onMove(moveEvent: PointerEvent) {
        const deltaTime = (moveEvent.clientX - startClientX) / pxPerSec.value
        throttler.queue(() => {
          if (side === 'left') {
            trimSegmentStart(segment.id, startTime + deltaTime)
          } else {
            trimSegmentEnd(segment.id, startTime + deltaTime)
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

  function onBodyPointerDown(event: PointerEvent) {
    const element = event.currentTarget as HTMLElement
    const trackElement = element.closest('[data-track]') as HTMLElement | null
    if (!trackElement) return
    event.stopPropagation()
    element.setPointerCapture(event.pointerId)
    const startClientX = event.clientX
    let moved = false

    function onMove(moveEvent: PointerEvent) {
      if (!moved && Math.abs(moveEvent.clientX - startClientX) > 8) {
        moved = true
      }
      if (moved && trackElement) {
        const rect = trackElement.getBoundingClientRect()
        const x = moveEvent.clientX - rect.left + trackElement.scrollLeft - GAP_PX
        const dropIndex = findDropIndexAtTrackX(timeline.value, x, pxPerSec.value, GAP_PX)
        dragState.value = { segmentId: segment.id, dropIndex }
      }
    }

    function onUp() {
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerup', onUp)
      if (moved && dragState.value) {
        reorderSegment(segment.id, dragState.value.dropIndex)
        dragState.value = null
      } else if (!moved) {
        selectedSegmentId.value = segment.id
        if (trackElement) {
          const rect = trackElement.getBoundingClientRect()
          const x = event.clientX - rect.left + trackElement.scrollLeft
          const segmentStartX = startX
          const time = segment.startTime + Math.max(0, x - segmentStartX) / pxPerSec.value
          const clamped = clampPlayheadForSegment(segment, time)
          seek(clamped)
        }
      }
    }

    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerup', onUp)
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
        onClick={(event) => event.stopPropagation()}
      />
      <div
        ref={rightRef}
        class="absolute top-0 right-0 bottom-0 z-20 w-2 cursor-ew-resize bg-white/40 transition-colors hover:bg-white/70 hover:duration-0"
        onPointerDown={onTrimPointerDown('right')}
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  )
}
