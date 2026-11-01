import type { ReadonlySignal } from '@preact/signals'
import clsx from 'clsx/lite'
import { VolumeX } from 'lucide-preact'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'

import {
  clipBlockHasFocus,
  focusClipBlock,
  followSelectionFocus,
} from '@/components/focusClipBlock'
import type { ScrollWindow } from '@/components/useTimelineNavigation'
import { WaveformView } from '@/components/WaveformView'
import { copyPreview } from '@/lib/copyExport'
import { formatPreciseTime, formatSignedSeconds, formatTime } from '@/lib/format'
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
  deleteSegment,
  endGesture,
  moveSegment,
  reorderSegment,
  trimSegmentEnd,
  trimSegmentStart,
} from '@/lib/timelineEditing'
import { adjacentId, clipBlockLabel } from '@/lib/timelineKeyboard'
import {
  BLOCK_DURATION_MIN_WIDTH_PX,
  BLOCK_NAME_MIN_WIDTH_PX,
  MIN_BLOCK_WIDTH_PX,
} from '@/lib/timelineNavigation'
import { DEFAULT_SNAP_FPS, resolveEdgeTime, snapThresholdSeconds } from '@/lib/timelineSnap'
import type { Segment } from '@/lib/types'
import { ensureClipWaveform } from '@/lib/videoImport'

const focusSegment = (segmentId: string) => focusClipBlock(`[data-segment-id="${segmentId}"]`)

export function SegmentBlock({
  segment,
  isDragging,
  startX,
  width,
  isTabStop,
  scrollWindow,
}: {
  segment: Segment
  isDragging?: boolean
  startX: number
  width: number
  // The one block in the tab order (roving tabindex).
  isTabStop: boolean
  // The track's visible window, so the waveform draws only what is in view.
  scrollWindow?: ReadonlySignal<ScrollWindow>
}) {
  const clip = clips.value.find((clip) => clip.id === segment.clipId) ?? getClipById(segment.clipId)
  const segmentDuration = segment.endTime - segment.startTime
  const isSelected = selectedSegmentId.value === segment.id
  const preview = copyPreview.value
  const copyShift = preview?.status === 'ready' ? preview.shifts.get(segment.id) : undefined
  const showCopyShift = copyShift !== undefined && Math.abs(copyShift.shiftSec) >= 0.0005
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!clip) return
    if ((clip.waveformPeaks?.length ?? 0) > 0) return
    void ensureClipWaveform(clip.id)
  }, [clip?.id, clip?.waveformPeaks?.length])

  // In the same commit as the render, so a key pressed right after the
  // selection moved lands on the new block, not the stale one.
  useLayoutEffect(() => {
    if (isTabStop && isSelected) {
      followSelectionFocus('data-segment', `[data-segment-id="${segment.id}"]`)
    }
  }, [isTabStop, isSelected, segment.id])

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

  // Keyboard use of a focused block. Plain arrows move the selection to the
  // neighbouring block, Alt+arrows reorder, Delete removes. Handled keys are
  // prevented so the global shortcuts (frame steps, delete) skip them.
  function onKeyDown(event: KeyboardEvent) {
    if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey) return
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    if (step !== 0 && !event.shiftKey) {
      event.preventDefault()
      if (event.altKey) {
        moveSegment(segment.id, step)
        focusSegment(segment.id)
        return
      }
      const next = adjacentId(
        timeline.value.map((entry) => entry.id),
        segment.id,
        step
      )
      const nextSegment = timeline.value.find((entry) => entry.id === next)
      if (!nextSegment) return
      selectedSegmentId.value = nextSegment.id
      seek(nextSegment.startTime)
      focusSegment(nextSegment.id)
      return
    }
    if (event.key === 'Enter' && !event.altKey && !event.shiftKey) {
      event.preventDefault()
      selectedSegmentId.value = segment.id
      seek(segment.startTime)
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !event.altKey) {
      event.preventDefault()
      deleteSegment(segment.id)
      // The timeline selected the block that took its place.
      const nextId = selectedSegmentId.value
      if (nextId) focusSegment(nextId)
    }
  }

  function onBodyPointerDown(event: PointerEvent) {
    if (event.button !== 0) return
    const element = event.currentTarget as HTMLElement
    const trackElement = element.closest('[data-track]') as HTMLElement | null
    if (!trackElement) return
    event.stopPropagation()
    // A click must not move focus onto the block: arrow keys there move the
    // selection, while after a click they should keep stepping frames. When
    // a block already has keyboard focus, the focus follows the click.
    const keepFocus = clipBlockHasFocus('data-segment')
    event.preventDefault()
    if (keepFocus) element.focus({ preventScroll: true })
    // Otherwise blur, as a click on the track always did, so Space plays
    // rather than pressing whatever button was focused before.
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
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
      data-segment-id={segment.id}
      role="option"
      aria-selected={isSelected}
      aria-label={clipBlockLabel(clip?.name ?? 'Clip', formatTime(segmentDuration), segment.muted)}
      tabIndex={isTabStop ? 0 : -1}
      onKeyDown={onKeyDown}
      class={clsx(
        'relative flex h-14 shrink-0 cursor-grab touch-none items-center overflow-hidden rounded border select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white',
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
      {showCopyShift && (
        // Where an Original export really starts: the key frame before the in
        // point sits left of the block, so the line marks its edge with how
        // far back it is; a key frame after the in point is drawn in place.
        <div
          data-copy-snap
          role="img"
          aria-label={`Original export starts at the key frame at ${formatPreciseTime(copyShift.snappedStart)}, ${formatSignedSeconds(-copyShift.shiftSec)} from the cut`}
          class="pointer-events-none absolute inset-y-0 z-10 border-l-2 border-dashed border-amber-300"
          style={{
            left: `${Math.max(0, -copyShift.shiftSec) * (segmentDuration > 0 ? width / segmentDuration : 0)}px`,
          }}
        >
          {width >= BLOCK_NAME_MIN_WIDTH_PX && (
            <span class="absolute bottom-0.5 left-3 rounded bg-slate-900/70 px-1 text-xs text-amber-200 tabular-nums">
              {formatSignedSeconds(-copyShift.shiftSec)}
            </span>
          )}
        </div>
      )}
      {/* Labels would only be clipped noise on a block this narrow. */}
      {width >= BLOCK_NAME_MIN_WIDTH_PX && (
        <span class="relative z-10 mt-1 self-start truncate px-2 text-sm font-medium text-white">
          {clip?.name ?? 'Clip'}
          {segment.muted && (
            <VolumeX
              class="ml-1 inline-block size-3.5 align-middle"
              role="img"
              aria-label="Muted"
            />
          )}
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
