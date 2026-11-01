import type { ReadonlySignal } from '@preact/signals'
import clsx from 'clsx/lite'
import { useEffect, useRef } from 'preact/hooks'

import type { ScrollWindow } from '@/components/useTimelineNavigation'
import { WaveformView } from '@/components/WaveformView'
import { formatTime } from '@/lib/format'
import {
  beginEdgePreview,
  endEdgePreview,
  getActiveSegmentInfo,
  previewEdgeFrame,
  seek,
} from '@/lib/playback'
import { selectedSegmentId, timeline, getClipById, clips, playheadTime } from '@/lib/store'
import { GAP_PX, PADDING_PX, clipColor, dragState, pxPerSec, trimFeedback } from '@/lib/store'
import { createRafThrottler } from '@/lib/timelineDomain'
import { clampPlayheadForSegment, findDropIndexAtTrackX } from '@/lib/timelineDomain'
import {
  beginGesture,
  endGesture,
  reorderSegment,
  trimSegmentEnd,
  trimSegmentStart,
} from '@/lib/timelineEditing'
import {
  BLOCK_DURATION_MIN_WIDTH_PX,
  BLOCK_NAME_MIN_WIDTH_PX,
  MIN_BLOCK_WIDTH_PX,
} from '@/lib/timelineNavigation'
import { DEFAULT_SNAP_FPS, resolveEdgeTime, snapThresholdSeconds } from '@/lib/timelineSnap'
import type { Segment } from '@/lib/types'
import { ensureClipWaveform } from '@/lib/videoImport'

export function SegmentBlock({
  segment,
  isDragging,
  startX,
  width,
  scrollWindow,
}: {
  segment: Segment
  isDragging?: boolean
  startX: number
  width: number
  // The track's visible window, so the waveform draws only what is in view.
  scrollWindow?: ReadonlySignal<ScrollWindow>
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

  // Ends a trim still in progress if the block unmounts mid-drag (e.g. Delete).
  const cancelTrimRef = useRef<(() => void) | null>(null)
  useEffect(() => () => cancelTrimRef.current?.(), [])

  function onTrimPointerDown(side: 'left' | 'right') {
    return (event: PointerEvent) => {
      event.stopPropagation()
      if (event.button !== 0) return
      const handle = side === 'left' ? leftRef.current! : rightRef.current!
      handle.setPointerCapture(event.pointerId)
      const startClientX = event.clientX
      const originalEdge = side === 'left' ? segment.startTime : segment.endTime
      const frameRate = clip?.frameRate || DEFAULT_SNAP_FPS
      // The playhead is a source time of the active segment's clip, so it is a
      // meaningful target only when that is this clip. Read before selecting.
      const active = getActiveSegmentInfo()
      const playheadTarget = active?.clip.id === segment.clipId ? [playheadTime.peek()] : []
      // The clip's start and end, and where the edge began.
      const targets = [0, clip?.duration ?? segment.endTime, originalEdge, ...playheadTarget].sort(
        (first, second) => first - second
      )

      // One undo history entry per trim gesture, not per pointer move. Begun
      // before selecting, so undo restores the previous selection too.
      beginGesture()
      selectedSegmentId.value = segment.id
      beginEdgePreview()
      trimFeedback.value = {
        segmentId: segment.id,
        side: side === 'left' ? 'start' : 'end',
        snapped: false,
      }
      const throttler = createRafThrottler()

      // The source time on screen for an edge: the first kept frame on the
      // left, the last kept frame on the right.
      function edgeFrame(trimmed: Segment): number {
        if (side === 'left') return trimmed.startTime
        return Math.max(trimmed.startTime, trimmed.endTime - 1 / frameRate)
      }

      function apply(pointerEvent: PointerEvent) {
        const rawEdge = originalEdge + (pointerEvent.clientX - startClientX) / pxPerSec.value
        const resolved = resolveEdgeTime(rawEdge, targets, {
          thresholdSec: snapThresholdSeconds(pxPerSec.value),
          // Alt places freely for one gesture, as in Advanced.
          snap: !pointerEvent.altKey,
          fps: frameRate,
        })
        if (side === 'left') trimSegmentStart(segment.id, resolved.time)
        else trimSegmentEnd(segment.id, resolved.time)
        const trimmed = timeline.peek().find((entry) => entry.id === segment.id)
        if (!trimmed) return
        const edge = side === 'left' ? trimmed.startTime : trimmed.endTime
        previewEdgeFrame(edgeFrame(trimmed))
        trimFeedback.value = {
          segmentId: segment.id,
          side: side === 'left' ? 'start' : 'end',
          // A clamp (minimum length, clip bounds) can stop short of the target.
          snapped: resolved.target !== null && Math.abs(edge - resolved.target) < 1e-9,
        }
      }

      function finish() {
        cancelTrimRef.current = null
        throttler.cancel()
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        handle.removeEventListener('pointercancel', onUp)
        trimFeedback.value = null
        const trimmed = timeline.peek().find((entry) => entry.id === segment.id)
        endEdgePreview(trimmed ? edgeFrame(trimmed) : playheadTime.peek())
        endGesture()
      }

      function onMove(moveEvent: PointerEvent) {
        throttler.queue(() => apply(moveEvent))
      }

      function onUp(upEvent: PointerEvent) {
        // Land exactly where the pointer was released.
        if (upEvent.type === 'pointerup') apply(upEvent)
        finish()
      }

      cancelTrimRef.current = finish
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
    }
  }

  function onBodyPointerDown(event: PointerEvent) {
    if (event.button !== 0) return
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
        const x = moveEvent.clientX - rect.left + trackElement.scrollLeft - PADDING_PX
        const dropIndex = findDropIndexAtTrackX(
          timeline.value,
          x,
          pxPerSec.value,
          GAP_PX,
          MIN_BLOCK_WIDTH_PX
        )
        dragState.value = { segmentId: segment.id, dropIndex }
      }
    }

    function onCancel() {
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerup', onUp)
      element.removeEventListener('pointercancel', onCancel)
      dragState.value = null
    }

    function onUp() {
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerup', onUp)
      element.removeEventListener('pointercancel', onCancel)
      if (moved && dragState.value) {
        reorderSegment(segment.id, dragState.value.dropIndex)
        dragState.value = null
      } else if (!moved) {
        selectedSegmentId.value = segment.id
        if (trackElement) {
          const rect = trackElement.getBoundingClientRect()
          const x = event.clientX - rect.left + trackElement.scrollLeft
          // Proportional, since a short block can be drawn wider than its duration.
          const offset = width > 0 ? Math.max(0, x - startX) / width : 0
          const time = segment.startTime + offset * segmentDuration
          const clamped = clampPlayheadForSegment(segment, time)
          seek(clamped)
        }
      }
    }

    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerup', onUp)
    element.addEventListener('pointercancel', onCancel)
  }

  return (
    <div
      data-segment
      class={clsx(
        'relative flex h-14 shrink-0 cursor-grab touch-none items-center overflow-hidden rounded border select-none',
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
          peaks={clip.waveformPeaks}
          clipDuration={clip.duration}
          segmentStart={segment.startTime}
          segmentEnd={segment.endTime}
          width={width}
          contentX={startX}
          scrollWindow={scrollWindow}
          class="opacity-80"
        />
      )}
      {/* Labels would only be clipped noise on a block this narrow. */}
      {width >= BLOCK_NAME_MIN_WIDTH_PX && (
        <span class="relative z-10 mt-1 self-start truncate px-2 text-sm font-medium text-white">
          {clip?.name ?? 'Clip'}
          {segment.muted && <span class="ml-1">🔇</span>}
        </span>
      )}
      {width >= BLOCK_DURATION_MIN_WIDTH_PX && (
        <span class="relative z-10 ml-auto shrink-0 self-end pr-2 text-sm text-white/70">
          {formatTime(segmentDuration)}
        </span>
      )}
      <div
        ref={leftRef}
        class="absolute top-0 bottom-0 left-0 z-20 w-2 cursor-ew-resize touch-none bg-white/40 transition-colors hover:bg-white/70 hover:duration-0"
        onPointerDown={onTrimPointerDown('left')}
        onClick={(event) => event.stopPropagation()}
      />
      <div
        ref={rightRef}
        class="absolute top-0 right-0 bottom-0 z-20 w-2 cursor-ew-resize touch-none bg-white/40 transition-colors hover:bg-white/70 hover:duration-0"
        onPointerDown={onTrimPointerDown('right')}
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  )
}
