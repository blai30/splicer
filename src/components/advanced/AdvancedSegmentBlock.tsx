import type { ReadonlySignal } from '@preact/signals'
import { useSignal } from '@preact/signals'
import clsx from 'clsx/lite'
import { VolumeX } from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'

import { clipBlockHasFocus, focusClipBlock } from '@/components/focusClipBlock'
import type { ScrollWindow } from '@/components/useTimelineNavigation'
import { WaveformView } from '@/components/WaveformView'
import { beginAdvancedGesture, endAdvancedGesture } from '@/lib/advanced/advancedHistory'
import {
  moveSegment,
  moveSegments,
  moveSegmentToNewTrack,
  trimSegmentEnd,
  trimSegmentStart,
} from '@/lib/advanced/advancedSegmentEditing'
import {
  selectAdvancedSegment,
  setActiveAdvancedTrack,
  type SelectionMode,
} from '@/lib/advanced/advancedSelection'
import {
  laneDropTarget,
  placeReadout,
  segmentDuration,
  segmentEndTime,
  TIMELINE_PAD_LEFT,
  type LaneDropTarget,
  type VisibleWindow,
} from '@/lib/advanced/advancedTimelineDomain'
import {
  deleteAdvancedSelected,
  rippleDeleteAdvancedSelected,
} from '@/lib/advanced/advancedTimelineEditing'
import { clampLaneDelta } from '@/lib/advanced/clipEditingDomain'
import { formatPreciseTime, formatSignedSeconds, formatTime } from '@/lib/format'
import {
  advancedClipDragActive,
  advancedClipMenu,
  advancedDragPreviewEnd,
  advancedGroupMovePreview,
  advancedNewTrackTarget,
  advancedPlayhead,
  advancedSegments,
  advancedSelectedIds,
  advancedSelectedSet,
  advancedSnapEnabled,
  advancedSnapLine,
  advancedTracks,
  clipColor,
  framerate,
  getClipById,
  pxPerSec,
} from '@/lib/store'
import { createEdgeAutoScroller, createRafThrottler } from '@/lib/timelineDomain'
import { advancedNeighbourId, clipBlockLabel, type ArrowDirection } from '@/lib/timelineKeyboard'
import { BLOCK_DURATION_MIN_WIDTH_PX, BLOCK_NAME_MIN_WIDTH_PX } from '@/lib/timelineNavigation'
import {
  resolveEdgeTime,
  resolveGroupMoveDelta,
  resolveMoveStart,
  snapThresholdSeconds,
  timelineFrameGrid,
  timeSnapTargets,
} from '@/lib/timelineSnap'
import type { AdvancedSegment } from '@/lib/types'
import { ensureClipWaveform } from '@/lib/videoImport'

type MovePreview = { start: number; target: LaneDropTarget; snapTarget: number | null }
type PointerSample = { clientX: number; clientY: number; altKey: boolean }

// Where an edit gesture measures from: the scroller (for scroll-aware deltas and
// edge auto-scroll) and the lanes container (for the lane under the pointer).
function gestureSurfaces(element: HTMLElement) {
  return {
    scroller: element.closest<HTMLElement>('[data-advanced-scroller]'),
    lanes: element.closest<HTMLElement>('[data-advanced-lanes]'),
  }
}

function samplePointer(event: PointerEvent): PointerSample {
  return { clientX: event.clientX, clientY: event.clientY, altKey: event.altKey }
}

// Alt can change while the pointer holds still; no pointer event reports that,
// so the gesture listens for the key itself to keep the preview honest.
function listenForAltChanges(onChange: (altKey: boolean) => void): () => void {
  function onKey(event: KeyboardEvent) {
    if (event.key === 'Alt') onChange(event.type === 'keydown')
  }
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKey)
  return () => {
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('keyup', onKey)
  }
}

function visibleWindow(scroller: HTMLElement | null): VisibleWindow | null {
  return scroller ? { left: scroller.scrollLeft, width: scroller.clientWidth } : null
}

// All drags share one frame grid so mixed-rate clips line up at export.
function projectFrameGrid(): number {
  const rates = advancedSegments.value.map((entry) => getClipById(entry.clipId)?.frameRate ?? 0)
  return timelineFrameGrid(framerate.value, rates)
}

// Ctrl/Cmd-click toggles one clip, Shift-click selects a range; either one
// only edits the selection and never starts a drag.
function clickSelectionMode(event: PointerEvent | MouseEvent): SelectionMode | null {
  if (event.ctrlKey || event.metaKey) return 'toggle'
  if (event.shiftKey) return 'range'
  return null
}

// Snap only to an exact landing: a trim clamped short of its target (by the
// media bounds or the minimum length) shows no line.
function landedOn(edge: number, target: number | null): number | null {
  return target !== null && Math.abs(edge - target) < 1e-6 ? target : null
}

const ARROW_DIRECTIONS: Record<string, ArrowDirection> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}

const focusAdvancedBlock = (segmentId: string) =>
  focusClipBlock(`[data-advanced-segment-id="${segmentId}"]`)

// Select a clip from the keyboard and carry focus to it.
function moveKeyboardSelection(segmentId: string, extend: boolean) {
  const target = advancedSegments.value.find((entry) => entry.id === segmentId)
  if (!target) return
  selectAdvancedSegment(segmentId, extend ? 'add' : 'replace')
  setActiveAdvancedTrack(target.trackId)
  focusAdvancedBlock(segmentId)
}

export function AdvancedSegmentBlock({
  segment,
  laneHeight,
  width,
  raised,
  isTabStop,
  scrollWindow,
}: {
  segment: AdvancedSegment
  laneHeight: number
  // The one block in the tab order (roving tabindex).
  isTabStop: boolean
  // Drawn width in px (see advancedBlockSpans).
  width: number
  // A short clip widened past its duration, drawn over its neighbours.
  raised: boolean
  // The scroller's visible window, so the waveform draws only what is in view.
  scrollWindow?: ReadonlySignal<ScrollWindow>
}) {
  // Live drop preview while the body is dragged, so the block follows the
  // pointer before the move commits on release.
  const movePreview = useSignal<MovePreview | null>(null)
  const trimSide = useSignal<'left' | 'right' | null>(null)
  const readoutWindow = useSignal<VisibleWindow | null>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  // Ends an in-flight gesture if the block unmounts mid-drag (e.g. Delete).
  const cancelGestureRef = useRef<(() => void) | null>(null)
  const clip = getClipById(segment.clipId)
  const duration = segmentDuration(segment)
  const isSelected = advancedSelectedSet.value.has(segment.id)
  // Set while another selected clip is dragged: this one follows it.
  const groupPreview = advancedGroupMovePreview.value
  const following = groupPreview?.ids.has(segment.id) ? groupPreview : null
  const left = TIMELINE_PAD_LEFT + segment.timelineStart * pxPerSec.value
  const tracks = advancedTracks.value
  const laneIndex = tracks.findIndex((track) => track.id === segment.trackId)

  useEffect(() => {
    if (!clip) return
    if ((clip.waveformPeaks?.length ?? 0) > 0) return
    void ensureClipWaveform(clip.id)
  }, [clip?.id, clip?.waveformPeaks?.length])

  useEffect(() => () => cancelGestureRef.current?.(), [])

  function snapOptions(altKey: boolean, fps: number) {
    return {
      thresholdSec: snapThresholdSeconds(pxPerSec.value),
      // Holding Alt places freely for one gesture without turning snapping off.
      snap: advancedSnapEnabled.value && !altKey,
      fps,
    }
  }

  function onTrimPointerDown(side: 'left' | 'right') {
    return (event: PointerEvent) => {
      event.stopPropagation()
      if (event.button !== 0) return
      const handle = (side === 'left' ? leftRef.current : rightRef.current)!
      handle.setPointerCapture(event.pointerId)
      const { scroller } = gestureSurfaces(handle)
      const startClientX = event.clientX
      const startScrollLeft = scroller?.scrollLeft ?? 0
      const origin = segment
      const originEnd = segmentEndTime(origin)
      const targets = timeSnapTargets(
        advancedSegments.value,
        new Set([origin.id]),
        advancedPlayhead.value
      )
      const fps = projectFrameGrid()
      let lastPointer = samplePointer(event)
      let moved = false
      // One undo entry per trim gesture, consumed by the first trim mutation.
      beginAdvancedGesture()
      trimSide.value = side
      readoutWindow.value = visibleWindow(scroller)
      const throttler = createRafThrottler()
      const autoScroll = scroller
        ? createEdgeAutoScroller(scroller, () => throttler.queue(() => apply(lastPointer)))
        : null
      const stopAltListening = listenForAltChanges((altKey) => {
        lastPointer = { ...lastPointer, altKey }
        if (moved) throttler.queue(() => apply(lastPointer))
      })

      // The dragged edge moves in timeline time (where the snap targets live),
      // then converts back to the source time the trim actions take.
      function apply(pointer: PointerSample) {
        const scrollDelta = (scroller?.scrollLeft ?? 0) - startScrollLeft
        const deltaTime = (pointer.clientX - startClientX + scrollDelta) / pxPerSec.value
        const rawEdge = (side === 'left' ? origin.timelineStart : originEnd) + deltaTime
        const edge = resolveEdgeTime(rawEdge, targets, snapOptions(pointer.altKey, fps))
        const nextSourceTime = origin.sourceStart + (edge.time - origin.timelineStart)
        if (side === 'left') trimSegmentStart(origin.id, nextSourceTime)
        else trimSegmentEnd(origin.id, nextSourceTime)
        const live = advancedSegments.value.find((entry) => entry.id === origin.id)
        if (!live) return
        const landedEdge = side === 'left' ? live.timelineStart : segmentEndTime(live)
        advancedSnapLine.value = landedOn(landedEdge, edge.target)
        readoutWindow.value = visibleWindow(scroller)
      }
      function onMove(moveEvent: PointerEvent) {
        lastPointer = samplePointer(moveEvent)
        if (moveEvent.clientX !== startClientX) moved = true
        if (!moved) return
        throttler.queue(() => apply(lastPointer))
        autoScroll?.update(moveEvent.clientX)
      }
      function finish(upEvent: PointerEvent | null) {
        throttler.cancel()
        autoScroll?.stop()
        stopAltListening()
        // Land exactly where the pointer was released. A click without movement
        // must not re-quantize an untouched edge.
        if (upEvent?.type === 'pointerup' && moved) apply(samplePointer(upEvent))
        endAdvancedGesture()
        trimSide.value = null
        readoutWindow.value = null
        advancedSnapLine.value = null
        cancelGestureRef.current = null
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', finish)
        handle.removeEventListener('pointercancel', finish)
      }
      cancelGestureRef.current = () => finish(null)
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', finish)
      handle.addEventListener('pointercancel', finish)
    }
  }

  function onContextMenu(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    // A right-click on a clip outside the selection acts on that clip alone;
    // inside it, the menu acts on the whole selection with this clip primary.
    selectAdvancedSegment(segment.id, advancedSelectedSet.value.has(segment.id) ? 'add' : 'replace')
    setActiveAdvancedTrack(segment.trackId)
    advancedClipMenu.value = { segmentId: segment.id, x: event.clientX, y: event.clientY }
  }

  // Keyboard use of a focused block: arrows move the selection to the
  // neighbouring clip (Shift adds it to the selection), Enter selects this one
  // alone, Delete removes the selection and focuses a neighbour. Alt+arrows
  // stay with the global one-frame nudge. Handled keys are prevented so the
  // global shortcuts skip them.
  function onKeyDown(event: KeyboardEvent) {
    if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey) return
    const direction = ARROW_DIRECTIONS[event.key]
    if (direction && !event.altKey) {
      event.preventDefault()
      const next = advancedNeighbourId(
        advancedSegments.value,
        advancedTracks.value,
        segment.id,
        direction
      )
      if (next) moveKeyboardSelection(next, event.shiftKey)
      return
    }
    if (event.key === 'Enter' && !event.altKey && !event.shiftKey) {
      event.preventDefault()
      moveKeyboardSelection(segment.id, false)
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !event.altKey) {
      event.preventDefault()
      const removed = new Set(advancedSelectedIds.value)
      removed.add(segment.id)
      // The nearest clip that survives the delete keeps the focus.
      const survivor = (['right', 'left', 'down', 'up'] as const)
        .map((toward) =>
          advancedNeighbourId(
            advancedSegments.value.filter(
              (entry) => entry.id === segment.id || !removed.has(entry.id)
            ),
            advancedTracks.value,
            segment.id,
            toward
          )
        )
        .find((id) => id !== null)
      if (!advancedSelectedIds.value.includes(segment.id)) selectAdvancedSegment(segment.id)
      if (event.shiftKey) rippleDeleteAdvancedSelected()
      else deleteAdvancedSelected()
      if (survivor) moveKeyboardSelection(survivor, false)
    }
  }

  function onBodyPointerDown(event: PointerEvent) {
    if (event.button !== 0) return
    event.stopPropagation()
    // A click must not move focus onto the block: arrow keys there move the
    // selection, while after a click they should keep stepping frames. When
    // a block already has keyboard focus, the focus follows the click.
    const keepFocus = clipBlockHasFocus('data-advanced-segment')
    event.preventDefault()
    if (keepFocus) (event.currentTarget as HTMLElement).focus({ preventScroll: true })
    // Otherwise blur, as a click on the timeline always did, so Space plays
    // rather than pressing whatever button was focused before.
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setActiveAdvancedTrack(segment.trackId)
    const selectionMode = clickSelectionMode(event)
    if (selectionMode) {
      selectAdvancedSegment(segment.id, selectionMode)
      return
    }
    const element = event.currentTarget as HTMLElement
    element.setPointerCapture(event.pointerId)
    const { scroller, lanes } = gestureSurfaces(element)
    const startClientX = event.clientX
    const startClientY = event.clientY
    const startScrollLeft = scroller?.scrollLeft ?? 0
    const origin = segment
    // Pressing a clip that is part of a multi-selection drags the whole group;
    // pressing any other clip selects just it.
    const selectedIds = advancedSelectedIds.value
    const isGroup = selectedIds.length > 1 && selectedIds.includes(origin.id)
    const groupIds = isGroup ? selectedIds : [origin.id]
    const groupIdSet = new Set(groupIds)
    // The dragged clip first, so its edges win snapping ties.
    const members = [
      origin,
      ...advancedSegments.value.filter(
        (entry) => groupIdSet.has(entry.id) && entry.id !== origin.id
      ),
    ]
    const memberSpans = members.map((entry) => ({
      start: entry.timelineStart,
      end: segmentEndTime(entry),
    }))
    const groupEnd = Math.max(...memberSpans.map((span) => span.end))
    // Computed once: nothing else moves while these clips are dragged.
    const targets = timeSnapTargets(advancedSegments.value, groupIdSet, advancedPlayhead.value)
    const fps = projectFrameGrid()
    let lastPointer = samplePointer(event)
    let moved = false
    // In a group the pressed clip becomes the primary; the group stays.
    selectAdvancedSegment(origin.id, isGroup ? 'add' : 'replace')
    const autoScroll = scroller
      ? createEdgeAutoScroller(scroller, () => preview(lastPointer))
      : null
    const stopAltListening = listenForAltChanges((altKey) => {
      lastPointer = { ...lastPointer, altKey }
      if (moved) preview(lastPointer)
    })

    function resolve(pointer: PointerSample): MovePreview {
      const scrollDelta = (scroller?.scrollLeft ?? 0) - startScrollLeft
      const rawDelta = (pointer.clientX - startClientX + scrollDelta) / pxPerSec.value
      const lanesTop = lanes?.getBoundingClientRect().top
      const laneCount = advancedTracks.value.length
      const target =
        lanesTop === undefined
          ? ({ kind: 'lane', index: laneIndex } as const)
          : laneDropTarget(pointer.clientY - lanesTop, laneHeight, laneCount)
      if (isGroup) {
        const { delta, target: snapTarget } = resolveGroupMoveDelta(
          rawDelta,
          origin.timelineStart,
          memberSpans,
          targets,
          snapOptions(pointer.altKey, fps)
        )
        // A group never creates tracks: past the edge lanes it stays on them,
        // and it moves only as far as every member still has a lane.
        const pointerLane =
          target.kind === 'lane' ? target.index : target.position === 'top' ? 0 : laneCount - 1
        const laneDelta = clampLaneDelta(members, advancedTracks.value, pointerLane - laneIndex)
        return {
          start: origin.timelineStart + delta,
          target: { kind: 'lane', index: laneIndex + laneDelta },
          snapTarget,
        }
      }
      const { start, target: snapTarget } = resolveMoveStart(
        origin.timelineStart + rawDelta,
        segmentDuration(origin),
        targets,
        snapOptions(pointer.altKey, fps)
      )
      return { start, target, snapTarget }
    }

    function preview(pointer: PointerSample) {
      const next = resolve(pointer)
      const deltaTime = next.start - origin.timelineStart
      movePreview.value = next
      readoutWindow.value = visibleWindow(scroller)
      advancedDragPreviewEnd.value = groupEnd + deltaTime
      advancedSnapLine.value = next.snapTarget
      advancedNewTrackTarget.value = next.target.kind === 'new' ? next.target.position : null
      if (isGroup && next.target.kind === 'lane') {
        advancedGroupMovePreview.value = {
          ids: new Set(groupIds.filter((id) => id !== origin.id)),
          deltaTime,
          laneDelta: next.target.index - laneIndex,
        }
      }
    }

    function onMove(moveEvent: PointerEvent) {
      lastPointer = samplePointer(moveEvent)
      if (
        !moved &&
        Math.hypot(moveEvent.clientX - startClientX, moveEvent.clientY - startClientY) > 4
      ) {
        moved = true
        // Only a single clip can be dropped onto a new track.
        if (!isGroup) advancedClipDragActive.value = true
      }
      if (!moved) return
      preview(lastPointer)
      autoScroll?.update(moveEvent.clientX)
    }
    function finish(upEvent: PointerEvent | null, commit: boolean) {
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerup', onUp)
      element.removeEventListener('pointercancel', onCancel)
      autoScroll?.stop()
      stopAltListening()
      movePreview.value = null
      readoutWindow.value = null
      advancedDragPreviewEnd.value = null
      advancedSnapLine.value = null
      advancedNewTrackTarget.value = null
      advancedClipDragActive.value = false
      advancedGroupMovePreview.value = null
      cancelGestureRef.current = null
      // A click on a member of a group, without dragging, selects just it.
      if (commit && !moved && isGroup) selectAdvancedSegment(origin.id)
      if (!commit || !moved || !upEvent) return
      const { start, target } = resolve(samplePointer(upEvent))
      if (isGroup) {
        if (target.kind === 'lane') {
          moveSegments(groupIds, start - origin.timelineStart, target.index - laneIndex)
        }
        return
      }
      if (target.kind === 'new') {
        moveSegmentToNewTrack(origin.id, target.position, start)
        return
      }
      const trackId = advancedTracks.value[target.index]?.id ?? origin.trackId
      moveSegment(origin.id, trackId, start)
    }
    function onUp(upEvent: PointerEvent) {
      finish(upEvent, true)
    }
    function onCancel(cancelEvent: PointerEvent) {
      finish(cancelEvent, false)
    }
    cancelGestureRef.current = () => finish(null, false)
    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerup', onUp)
    element.addEventListener('pointercancel', onCancel)
  }

  // A new-track drop previews in the nearest existing lane; the dashed drop
  // zone highlights to show where the track will be created.
  const preview = movePreview.value
  const previewLane =
    preview === null
      ? laneIndex
      : preview.target.kind === 'lane'
        ? preview.target.index
        : preview.target.position === 'top'
          ? 0
          : tracks.length - 1
  const offsetX = preview
    ? (preview.start - segment.timelineStart) * pxPerSec.value
    : following
      ? following.deltaTime * pxPerSec.value
      : 0
  const offsetY = following
    ? following.laneDelta * laneHeight
    : (previewLane - laneIndex) * laneHeight
  const offsetTransform = preview || following ? `translate(${offsetX}px, ${offsetY}px)` : undefined

  let readout: string | null = null
  if (preview) {
    const trackLabel =
      preview.target.kind === 'new' ? 'New track' : (tracks[preview.target.index]?.name ?? '')
    readout = [
      `Start ${formatPreciseTime(preview.start)}`,
      formatSignedSeconds(preview.start - segment.timelineStart),
      trackLabel,
    ].join(' · ')
  } else if (trimSide.value) {
    readout = [
      `In ${formatPreciseTime(segment.sourceStart)}`,
      `Out ${formatPreciseTime(segment.sourceEnd)}`,
      `Duration ${duration.toFixed(2)}s`,
    ].join(' · ')
  }

  const readoutPlacement = placeReadout(left + offsetX, width, readoutWindow.value)

  return (
    <>
      <div
        data-advanced-segment
        data-advanced-segment-id={segment.id}
        role="option"
        aria-selected={isSelected}
        aria-label={clipBlockLabel(
          clip?.name ?? 'Missing clip',
          formatTime(duration),
          segment.muted
        )}
        tabIndex={isTabStop ? 0 : -1}
        onKeyDown={onKeyDown}
        class={clsx(
          'absolute top-1 bottom-1 flex cursor-grab touch-none items-center overflow-hidden rounded border select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white',
          isSelected
            ? 'border-violet-400 ring-1 ring-violet-400'
            : 'border-black/10 dark:border-white/10',
          clipColor(segment.clipId),
          // Above neighbouring blocks' trim handles (z-20), below the playhead (z-30).
          raised && 'z-25',
          (preview || following) && 'z-40 cursor-grabbing opacity-80 shadow-lg'
        )}
        style={{ left: `${left}px`, width: `${width}px`, transform: offsetTransform }}
        data-selected={isSelected ? '' : undefined}
        title={
          clip
            ? `${clip.name} (drag to move, edges to trim, hold Alt to skip snapping; Ctrl-click or Shift-click to select several)`
            : 'Missing clip'
        }
        onPointerDown={onBodyPointerDown}
        onContextMenu={onContextMenu}
      >
        {clip && (
          <WaveformView
            peaks={clip.waveformPeaks}
            clipDuration={clip.duration}
            segmentStart={segment.sourceStart}
            segmentEnd={segment.sourceEnd}
            width={width}
            contentX={left + offsetX}
            scrollWindow={scrollWindow}
            class="opacity-80"
          />
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
            {formatTime(duration)}
          </span>
        )}
        <div
          ref={leftRef}
          class="absolute top-0 bottom-0 left-0 z-20 w-2 cursor-ew-resize touch-none bg-white/40 hover:bg-white/70 hover:duration-0"
          onPointerDown={onTrimPointerDown('left')}
        />
        <div
          ref={rightRef}
          class="absolute top-0 right-0 bottom-0 z-20 w-2 cursor-ew-resize touch-none bg-white/40 hover:bg-white/70 hover:duration-0"
          onPointerDown={onTrimPointerDown('right')}
        />
      </div>
      {readout && (
        <div
          data-advanced-readout
          aria-hidden="true"
          class={clsx(
            'pointer-events-none absolute -top-6 z-50 truncate rounded bg-slate-900/80 px-1.5 py-0.5 text-xs text-white tabular-nums shadow',
            readoutPlacement.alignEnd && '-translate-x-full'
          )}
          style={{
            left: `${readoutPlacement.edge}px`,
            maxWidth:
              readoutPlacement.maxWidth === null ? undefined : `${readoutPlacement.maxWidth}px`,
            transform: offsetY === 0 ? undefined : `translateY(${offsetY}px)`,
          }}
        >
          {readout}
        </div>
      )}
    </>
  )
}
