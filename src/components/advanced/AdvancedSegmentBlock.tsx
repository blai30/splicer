import { useSignal } from '@preact/signals'
import clsx from 'clsx/lite'
import { useEffect, useRef } from 'preact/hooks'

import { WaveformView } from '@/components/WaveformView'
import { beginAdvancedGesture, endAdvancedGesture } from '@/lib/advanced/advancedHistory'
import {
  trimSegmentEnd,
  trimSegmentStart,
  selectAdvancedSegment,
} from '@/lib/advanced/advancedSegmentEditing'
import { segmentDuration } from '@/lib/advanced/advancedTimelineDomain'
import { formatTime } from '@/lib/format'
import { advancedSelectedId, clipColor, getClipById, pxPerSec } from '@/lib/store'
import { createRafThrottler } from '@/lib/timelineDomain'
import type { AdvancedSegment } from '@/lib/types'
import { ensureClipWaveform } from '@/lib/videoImport'

export function AdvancedSegmentBlock({
  segment,
  laneHeight,
  onRequestMove,
}: {
  segment: AdvancedSegment
  laneHeight: number
  onRequestMove: (deltaTime: number, deltaLanes: number) => void
}) {
  // Live offset while the body is being dragged (time in px, lanes in px), so
  // the block follows the pointer before the move commits on release.
  const dragOffset = useSignal<{ x: number; y: number } | null>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const clip = getClipById(segment.clipId)
  const duration = segmentDuration(segment)
  const isSelected = advancedSelectedId.value === segment.id
  const left = segment.timelineStart * pxPerSec.value
  const width = Math.max(2, duration * pxPerSec.value)

  useEffect(() => {
    if (!clip) return
    if ((clip.waveformPeaks?.length ?? 0) > 0) return
    void ensureClipWaveform(clip.id)
  }, [clip?.id, clip?.waveformPeaks?.length])

  function onTrimPointerDown(side: 'left' | 'right') {
    return (event: PointerEvent) => {
      event.stopPropagation()
      const handle = (side === 'left' ? leftRef.current : rightRef.current)!
      handle.setPointerCapture(event.pointerId)
      const startClientX = event.clientX
      const startValue = side === 'left' ? segment.sourceStart : segment.sourceEnd
      // One undo entry per trim gesture, consumed by the first trim mutation.
      beginAdvancedGesture()
      const throttler = createRafThrottler()

      function apply(pointerEvent: PointerEvent) {
        const deltaTime = (pointerEvent.clientX - startClientX) / pxPerSec.value
        if (side === 'left') trimSegmentStart(segment.id, startValue + deltaTime)
        else trimSegmentEnd(segment.id, startValue + deltaTime)
      }
      function onMove(moveEvent: PointerEvent) {
        throttler.queue(() => apply(moveEvent))
      }
      function onUp(upEvent: PointerEvent) {
        throttler.cancel()
        // Land exactly where the pointer was released.
        if (upEvent.type === 'pointerup') apply(upEvent)
        endAdvancedGesture()
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        handle.removeEventListener('pointercancel', onUp)
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
    }
  }

  function onBodyPointerDown(event: PointerEvent) {
    if (event.button !== 0) return
    event.stopPropagation()
    const element = event.currentTarget as HTMLElement
    element.setPointerCapture(event.pointerId)
    const startClientX = event.clientX
    const startClientY = event.clientY
    let moved = false
    selectAdvancedSegment(segment.id)

    // Clamp so the block never previews left of the timeline origin.
    function offsetFor(moveEvent: PointerEvent) {
      const minX = -segment.timelineStart * pxPerSec.value
      return {
        x: Math.max(minX, moveEvent.clientX - startClientX),
        y: Math.round((moveEvent.clientY - startClientY) / laneHeight) * laneHeight,
      }
    }

    function onMove(moveEvent: PointerEvent) {
      if (
        !moved &&
        Math.hypot(moveEvent.clientX - startClientX, moveEvent.clientY - startClientY) > 4
      ) {
        moved = true
      }
      if (moved) dragOffset.value = offsetFor(moveEvent)
    }
    function finish(upEvent: PointerEvent, commit: boolean) {
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerup', onUp)
      element.removeEventListener('pointercancel', onCancel)
      dragOffset.value = null
      if (!commit || !moved) return
      const offset = offsetFor(upEvent)
      onRequestMove(offset.x / pxPerSec.value, Math.round(offset.y / laneHeight))
    }
    function onUp(upEvent: PointerEvent) {
      finish(upEvent, true)
    }
    function onCancel(cancelEvent: PointerEvent) {
      finish(cancelEvent, false)
    }
    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerup', onUp)
    element.addEventListener('pointercancel', onCancel)
  }

  return (
    <div
      data-advanced-segment
      class={clsx(
        'absolute top-1 bottom-1 flex cursor-grab items-center overflow-hidden rounded border select-none',
        isSelected
          ? 'border-violet-400 ring-1 ring-violet-400'
          : 'border-black/10 dark:border-white/10',
        clipColor(segment.clipId),
        dragOffset.value && 'z-40 cursor-grabbing opacity-80 shadow-lg'
      )}
      style={{
        left: `${left}px`,
        width: `${width}px`,
        transform: dragOffset.value
          ? `translate(${dragOffset.value.x}px, ${dragOffset.value.y}px)`
          : undefined,
      }}
      title={clip ? `${clip.name} (drag to move, edges to trim)` : 'Missing clip'}
      onPointerDown={onBodyPointerDown}
    >
      {clip && (
        <WaveformView
          peaks={clip.waveformPeaks ?? []}
          clipDuration={clip.duration}
          segmentStart={segment.sourceStart}
          segmentEnd={segment.sourceEnd}
          class="absolute inset-0 h-full w-full opacity-80"
        />
      )}
      <span class="relative z-10 mt-1 self-start truncate px-2 text-sm font-medium text-white">
        {clip?.name ?? 'Clip'}
        {segment.muted && <span class="ml-1">{'\u{1F507}'}</span>}
      </span>
      <span class="relative z-10 ml-auto shrink-0 self-end pr-2 text-sm text-white/70">
        {formatTime(duration)}
      </span>
      <div
        ref={leftRef}
        class="absolute top-0 bottom-0 left-0 z-20 w-2 cursor-ew-resize bg-white/40 hover:bg-white/70 hover:duration-0"
        onPointerDown={onTrimPointerDown('left')}
      />
      <div
        ref={rightRef}
        class="absolute top-0 right-0 bottom-0 z-20 w-2 cursor-ew-resize bg-white/40 hover:bg-white/70 hover:duration-0"
        onPointerDown={onTrimPointerDown('right')}
      />
    </div>
  )
}
