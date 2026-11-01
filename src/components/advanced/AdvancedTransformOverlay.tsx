import { batch, useComputed, useSignal } from '@preact/signals'
import clsx from 'clsx/lite'
import { useEffect, useRef } from 'preact/hooks'

import { beginAdvancedGesture, endAdvancedGesture } from '@/lib/advanced/advancedHistory'
import { displayTime } from '@/lib/advanced/advancedPlayback'
import {
  setSegmentCrop,
  setSegmentTransform,
  setSegmentTransforms,
} from '@/lib/advanced/advancedSegmentEditing'
import { selectAdvancedSegment } from '@/lib/advanced/advancedSelection'
import { orderedForRender, segmentsActiveAt } from '@/lib/advanced/advancedTimelineDomain'
import { pointInTransform, screenDeltaToWorld } from '@/lib/advanced/canvasCoords'
import { snapFrameFor } from '@/lib/advanced/canvasPlacement'
import { defaultCrop, resizeCropWithBox } from '@/lib/advanced/cropMath'
import { computeFrameScenes, sceneIndexAt } from '@/lib/advanced/exportLayout'
import { snapCandidates, snapMove, snapResize } from '@/lib/advanced/snapMath'
import { RESIZE_HANDLES, type ResizeHandle } from '@/lib/advanced/transformMath'
import { screenToWorld, worldToScreen } from '@/lib/advanced/viewportMath'
import {
  advancedCanvasFocused,
  advancedOutputLock,
  advancedPlayhead,
  advancedSegments,
  advancedSelectedId,
  advancedSelectedSet,
  advancedTracks,
  advancedViewport,
  getClipById,
} from '@/lib/store'
import type { AdvancedSegment, Transform } from '@/lib/types'

const SNAP_THRESHOLD = 12

const HANDLE_CURSOR: Record<ResizeHandle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
}

function hiddenTrackIds(): Set<string> {
  return new Set(advancedTracks.value.filter((track) => track.hidden).map((track) => track.id))
}

function handlePercent(handle: ResizeHandle): { left: string; top: string } {
  const left = handle.includes('w') ? '0%' : handle.includes('e') ? '100%' : '50%'
  const top = handle.includes('n') ? '0%' : handle.includes('s') ? '100%' : '50%'
  return { left, top }
}

function isCornerHandle(handle: ResizeHandle): boolean {
  return handle.length === 2
}

// Snap lines for a gesture on `movingIds`: the other visible clips and, when
// other clips define it, the output frame.
function gestureCandidates(anchorId: string, movingIds: ReadonlySet<string>) {
  const hidden = hiddenTrackIds()
  const others = advancedSegments.value
    .filter((other) => !movingIds.has(other.id) && !hidden.has(other.trackId))
    .map((other) => other.transform)
  return snapCandidates(others, snapFrameFor(anchorId, movingIds))
}

export function AdvancedTransformOverlay({ cropMode }: { cropMode: boolean }) {
  // Some browsers do not fire blur when a focused element is removed, so clear
  // the flag on unmount or arrow keys would keep nudging clips.
  useEffect(
    () => () => {
      advancedCanvasFocused.value = false
    },
    []
  )
  const guideX = useSignal<number | null>(null)
  const guideY = useSignal<number | null>(null)
  // Shown under the selection box while it is resized.
  const resizing = useSignal(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const viewport = advancedViewport.value
  const selectedId = advancedSelectedId.value
  const selectedSet = advancedSelectedSet.value
  const selected = advancedSegments.value.find((segment) => segment.id === selectedId) ?? null
  const secondaries = advancedSegments.value.filter(
    (segment) => selectedSet.has(segment.id) && segment.id !== selectedId
  )
  // Frame what export renders: hidden tracks are left out of the output, and
  // each scene (clips on screen together) is framed on its own.
  const frameScenes = useComputed(() => {
    const hidden = hiddenTrackIds()
    return computeFrameScenes(
      advancedSegments.value.filter((segment) => !hidden.has(segment.trackId)),
      advancedOutputLock.value
    )
  })
  // An index, so playback re-renders the overlay only when the scene changes.
  const frameSceneIndex = useComputed(() =>
    sceneIndexAt(frameScenes.value, displayTime(advancedPlayhead.value))
  )
  const frame = frameScenes.value[frameSceneIndex.value]?.rect ?? null

  // Begin moving the selection with the pointer captured on `captureElement`.
  // Used by both the selection box (press the already-selected clip) and a
  // press on a clip in the background, so the move starts in the same gesture.
  // The pressed clip snaps; the rest of the selection keeps its offsets.
  function beginMove(anchor: AdvancedSegment, captureElement: HTMLElement, event: PointerEvent) {
    captureElement.setPointerCapture(event.pointerId)
    // One undo entry per move gesture, consumed by the first transform update.
    beginAdvancedGesture()
    const startX = event.clientX
    const startY = event.clientY
    const movingIds = new Set(advancedSelectedSet.value)
    movingIds.add(anchor.id)
    const startTransforms = new Map(
      advancedSegments.value
        .filter((segment) => movingIds.has(segment.id))
        .map((segment) => [segment.id, segment.transform])
    )
    const startTransform = anchor.transform
    const zoom = advancedViewport.value.zoom
    const candidates = gestureCandidates(anchor.id, movingIds)

    function onMove(moveEvent: PointerEvent) {
      const dx = screenDeltaToWorld(moveEvent.clientX - startX, zoom)
      const dy = screenDeltaToWorld(moveEvent.clientY - startY, zoom)
      const moved: Transform = {
        ...startTransform,
        x: startTransform.x + dx,
        y: startTransform.y + dy,
      }
      // Keep the snap distance constant on screen regardless of zoom.
      const snapped = snapMove(moved, candidates, SNAP_THRESHOLD / zoom)
      guideX.value = snapped.guideX
      guideY.value = snapped.guideY
      const shiftX = snapped.x - startTransform.x
      const shiftY = snapped.y - startTransform.y
      const next = new Map<string, Transform>()
      for (const [id, transform] of startTransforms) {
        next.set(id, { ...transform, x: transform.x + shiftX, y: transform.y + shiftY })
      }
      setSegmentTransforms(next)
    }
    function onUp() {
      guideX.value = null
      guideY.value = null
      endAdvancedGesture()
      captureElement.removeEventListener('pointermove', onMove)
      captureElement.removeEventListener('pointerup', onUp)
      captureElement.removeEventListener('pointercancel', onUp)
    }
    captureElement.addEventListener('pointermove', onMove)
    captureElement.addEventListener('pointerup', onUp)
    captureElement.addEventListener('pointercancel', onUp)
  }

  // Pressing the canvas: a press on a clip selects it and starts moving it in the
  // same gesture; a press on empty space deselects and pans the viewport.
  // Shift or Ctrl/Cmd adds or removes the clip from the selection instead.
  function onBackgroundPointerDown(event: PointerEvent) {
    if (event.button !== 0 && event.button !== 1) return
    const wrapper = event.currentTarget as HTMLElement
    // Arrow keys nudge only while the canvas has focus.
    rootRef.current?.focus({ preventScroll: true })
    const rect = wrapper.getBoundingClientRect()
    const world = screenToWorld(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      advancedViewport.value
    )
    // Only visible clips can be hit: hidden tracks are not drawn.
    const active = segmentsActiveAt(
      advancedSegments.value,
      displayTime(advancedPlayhead.value)
    ).filter((segment) => !hiddenTrackIds().has(segment.trackId))
    const topFirst = orderedForRender(active, advancedTracks.value).reverse()
    // The middle button always pans, even over a clip.
    const hit =
      event.button === 0
        ? topFirst.find((segment) => pointInTransform(world.x, world.y, segment.transform))
        : undefined
    const toggling = event.button === 0 && (event.shiftKey || event.ctrlKey || event.metaKey)
    if (hit) {
      if (toggling) {
        selectAdvancedSegment(hit.id, 'toggle')
        return
      }
      const inGroup = advancedSelectedSet.value.has(hit.id) && advancedSelectedSet.value.size > 1
      selectAdvancedSegment(hit.id, inGroup ? 'add' : 'replace')
      // In crop mode the body is not draggable; just select so the crop handles show.
      if (!cropMode) beginMove(hit, wrapper, event)
      return
    }
    if (!toggling) selectAdvancedSegment(null)
    // Pan the viewport.
    wrapper.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startY = event.clientY
    const startViewport = advancedViewport.value
    function onMove(moveEvent: PointerEvent) {
      advancedViewport.value = {
        ...startViewport,
        panX: startViewport.panX - (moveEvent.clientX - startX) / startViewport.zoom,
        panY: startViewport.panY - (moveEvent.clientY - startY) / startViewport.zoom,
      }
    }
    function onUp() {
      wrapper.removeEventListener('pointermove', onMove)
      wrapper.removeEventListener('pointerup', onUp)
      wrapper.removeEventListener('pointercancel', onUp)
    }
    wrapper.addEventListener('pointermove', onMove)
    wrapper.addEventListener('pointerup', onUp)
    wrapper.addEventListener('pointercancel', onUp)
  }

  function startMove(event: PointerEvent) {
    if (event.button !== 0 || !selected || cropMode) return
    // A modified press falls through to the background, which toggles.
    if (event.shiftKey || event.ctrlKey || event.metaKey) return
    event.stopPropagation()
    rootRef.current?.focus({ preventScroll: true })
    beginMove(selected, event.currentTarget as HTMLElement, event)
  }

  function startResize(handle: ResizeHandle) {
    return (event: PointerEvent) => {
      if (event.button !== 0 || !selected) return
      const active = selected
      event.stopPropagation()
      rootRef.current?.focus({ preventScroll: true })
      const element = event.currentTarget as HTMLElement
      element.setPointerCapture(event.pointerId)
      // One undo entry per resize/crop gesture, consumed by the first update.
      beginAdvancedGesture()
      const startX = event.clientX
      const startY = event.clientY
      const startTransform = active.transform
      const clip = getClipById(active.clipId)
      const startCrop = active.crop ?? (clip ? defaultCrop(clip.width, clip.height) : null)
      const zoom = advancedViewport.value.zoom
      const candidates = gestureCandidates(active.id, new Set([active.id]))
      resizing.value = !cropMode

      function onMove(moveEvent: PointerEvent) {
        const dx = screenDeltaToWorld(moveEvent.clientX - startX, zoom)
        const dy = screenDeltaToWorld(moveEvent.clientY - startY, zoom)
        if (cropMode && clip && startCrop) {
          // Map the world-space drag into source pixels via the transform box scale.
          const sx = (dx / startTransform.width) * startCrop.width
          const sy = (dy / startTransform.height) * startCrop.height
          const result = resizeCropWithBox(
            startTransform,
            startCrop,
            handle,
            sx,
            sy,
            clip.width,
            clip.height
          )
          batch(() => {
            setSegmentCrop(active.id, result.crop)
            setSegmentTransform(active.id, result.transform)
          })
          return
        }
        // Corners keep the clip's shape unless Shift is held, as media
        // editors do; edges always stretch one side.
        const lockAspect = isCornerHandle(handle) && !moveEvent.shiftKey
        const snapped = snapResize(
          startTransform,
          handle,
          dx,
          dy,
          lockAspect,
          candidates,
          SNAP_THRESHOLD / zoom
        )
        guideX.value = snapped.guideX
        guideY.value = snapped.guideY
        setSegmentTransform(active.id, snapped.transform)
      }
      function onUp() {
        endAdvancedGesture()
        resizing.value = false
        guideX.value = null
        guideY.value = null
        element.removeEventListener('pointermove', onMove)
        element.removeEventListener('pointerup', onUp)
        element.removeEventListener('pointercancel', onUp)
      }
      element.addEventListener('pointermove', onMove)
      element.addEventListener('pointerup', onUp)
      element.addEventListener('pointercancel', onUp)
    }
  }

  const selectedScreen = selected
    ? worldToScreen({ x: selected.transform.x, y: selected.transform.y }, viewport)
    : null
  const frameScreen = frame ? worldToScreen({ x: frame.minX, y: frame.minY }, viewport) : null

  return (
    <div
      ref={rootRef}
      data-advanced-canvas
      tabIndex={0}
      role="group"
      aria-label="Canvas. Arrow keys nudge the selected clips, Shift for 10 pixels."
      class="absolute inset-0 z-10 touch-none outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-inset"
      style={{ cursor: cropMode ? 'crosshair' : 'default' }}
      onPointerDown={onBackgroundPointerDown}
      onFocus={() => (advancedCanvasFocused.value = true)}
      onBlur={() => (advancedCanvasFocused.value = false)}
    >
      {frame && frameScreen && (
        <div
          class="pointer-events-none absolute border border-dashed border-sky-400/70"
          style={{
            left: `${frameScreen.x}px`,
            top: `${frameScreen.y}px`,
            width: `${frame.width * viewport.zoom}px`,
            height: `${frame.height * viewport.zoom}px`,
          }}
        />
      )}

      {guideX.value !== null && (
        <div
          data-canvas-guide
          class="pointer-events-none absolute top-0 bottom-0 w-px bg-violet-400"
          style={{ left: `${worldToScreen({ x: guideX.value, y: 0 }, viewport).x}px` }}
        />
      )}
      {guideY.value !== null && (
        <div
          data-canvas-guide
          class="pointer-events-none absolute right-0 left-0 h-px bg-violet-400"
          style={{ top: `${worldToScreen({ x: 0, y: guideY.value }, viewport).y}px` }}
        />
      )}

      {/* The rest of a multi-selection: outlined, moved with the primary. */}
      {secondaries.map((segment) => {
        const screen = worldToScreen({ x: segment.transform.x, y: segment.transform.y }, viewport)
        return (
          <div
            key={segment.id}
            data-canvas-secondary-selection
            class="pointer-events-none absolute border border-dashed border-violet-400"
            style={{
              left: `${screen.x}px`,
              top: `${screen.y}px`,
              width: `${segment.transform.width * viewport.zoom}px`,
              height: `${segment.transform.height * viewport.zoom}px`,
            }}
          />
        )
      })}

      {selected && selectedScreen && (
        <div
          data-canvas-selection
          class={
            cropMode
              ? 'absolute border-2 border-dashed border-amber-400'
              : 'absolute border border-violet-400'
          }
          style={{
            left: `${selectedScreen.x}px`,
            top: `${selectedScreen.y}px`,
            width: `${selected.transform.width * viewport.zoom}px`,
            height: `${selected.transform.height * viewport.zoom}px`,
            cursor: cropMode ? 'default' : 'move',
          }}
          onPointerDown={startMove}
        >
          {RESIZE_HANDLES.map((handle) => {
            const position = handlePercent(handle)
            return (
              <div
                key={handle}
                data-resize-handle={handle}
                class={clsx(
                  'absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white',
                  cropMode ? 'bg-amber-400' : 'bg-violet-500'
                )}
                style={{ left: position.left, top: position.top, cursor: HANDLE_CURSOR[handle] }}
                onPointerDown={startResize(handle)}
              />
            )
          })}
          {resizing.value && (
            <div
              data-canvas-size-readout
              class="pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded bg-slate-900/80 px-1.5 py-0.5 text-xs whitespace-nowrap text-white tabular-nums"
            >
              {Math.round(selected.transform.width)} × {Math.round(selected.transform.height)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
