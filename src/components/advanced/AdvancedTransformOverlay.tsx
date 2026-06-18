import { batch, useSignal } from '@preact/signals'

import { beginAdvancedGesture } from '@/lib/advanced/advancedHistory'
import {
  selectAdvancedSegment,
  setSegmentCrop,
  setSegmentTransform,
} from '@/lib/advanced/advancedSegmentEditing'
import { orderedForRender, segmentsActiveAt } from '@/lib/advanced/advancedTimelineDomain'
import { pointInTransform, screenDeltaToWorld } from '@/lib/advanced/canvasCoords'
import { defaultCrop, resizeCropWithBox } from '@/lib/advanced/cropMath'
import { computeFrameRect } from '@/lib/advanced/exportLayout'
import { snapCandidates, snapMove } from '@/lib/advanced/snapMath'
import { RESIZE_HANDLES, resizeTransform, type ResizeHandle } from '@/lib/advanced/transformMath'
import { screenToWorld, worldToScreen } from '@/lib/advanced/viewportMath'
import {
  advancedOutputLock,
  advancedPlayhead,
  advancedSegments,
  advancedSelectedId,
  advancedTracks,
  advancedViewport,
  getClipById,
} from '@/lib/store'
import type { Transform } from '@/lib/types'

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

function handlePercent(handle: ResizeHandle): { left: string; top: string } {
  const left = handle.includes('w') ? '0%' : handle.includes('e') ? '100%' : '50%'
  const top = handle.includes('n') ? '0%' : handle.includes('s') ? '100%' : '50%'
  return { left, top }
}

export function AdvancedTransformOverlay({ cropMode }: { cropMode: boolean }) {
  const guideX = useSignal<number | null>(null)
  const guideY = useSignal<number | null>(null)

  const viewport = advancedViewport.value
  const selectedId = advancedSelectedId.value
  const selected = advancedSegments.value.find((segment) => segment.id === selectedId) ?? null
  const frame = computeFrameRect(advancedSegments.value, advancedOutputLock.value)

  // Click on empty canvas selects the top-most active clip under the pointer;
  // dragging empty canvas pans the viewport.
  function onBackgroundPointerDown(event: PointerEvent) {
    const wrapper = event.currentTarget as HTMLElement
    const rect = wrapper.getBoundingClientRect()
    const world = screenToWorld(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      advancedViewport.value
    )
    const active = segmentsActiveAt(advancedSegments.value, advancedPlayhead.value)
    const topFirst = orderedForRender(active, advancedTracks.value).reverse()
    const hit = topFirst.find((segment) => pointInTransform(world.x, world.y, segment.transform))
    if (hit) {
      selectAdvancedSegment(hit.id)
      return
    }
    selectAdvancedSegment('')
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
    }
    wrapper.addEventListener('pointermove', onMove)
    wrapper.addEventListener('pointerup', onUp)
  }

  function startMove(event: PointerEvent) {
    if (!selected || cropMode) return
    const active = selected
    event.stopPropagation()
    const element = event.currentTarget as HTMLElement
    element.setPointerCapture(event.pointerId)
    // One undo entry per move gesture, consumed by the first transform update.
    beginAdvancedGesture()
    const startX = event.clientX
    const startY = event.clientY
    const startTransform = active.transform
    const zoom = advancedViewport.value.zoom
    const others = advancedSegments.value
      .filter((segment) => segment.id !== active.id)
      .map((segment) => segment.transform)
    const candidates = snapCandidates(others)

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
      setSegmentTransform(active.id, { ...moved, x: snapped.x, y: snapped.y })
    }
    function onUp() {
      guideX.value = null
      guideY.value = null
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerup', onUp)
    }
    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerup', onUp)
  }

  function startResize(handle: ResizeHandle) {
    return (event: PointerEvent) => {
      if (!selected) return
      const active = selected
      event.stopPropagation()
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
        } else {
          setSegmentTransform(
            active.id,
            resizeTransform(startTransform, handle, dx, dy, moveEvent.shiftKey)
          )
        }
      }
      function onUp() {
        element.removeEventListener('pointermove', onMove)
        element.removeEventListener('pointerup', onUp)
      }
      element.addEventListener('pointermove', onMove)
      element.addEventListener('pointerup', onUp)
    }
  }

  const selectedScreen = selected
    ? worldToScreen({ x: selected.transform.x, y: selected.transform.y }, viewport)
    : null
  const frameScreen = frame ? worldToScreen({ x: frame.minX, y: frame.minY }, viewport) : null

  return (
    <div
      class="absolute inset-0 z-10"
      style={{ cursor: cropMode ? 'crosshair' : 'default' }}
      onPointerDown={onBackgroundPointerDown}
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
          class="pointer-events-none absolute top-0 bottom-0 w-px bg-violet-400"
          style={{ left: `${worldToScreen({ x: guideX.value, y: 0 }, viewport).x}px` }}
        />
      )}
      {guideY.value !== null && (
        <div
          class="pointer-events-none absolute right-0 left-0 h-px bg-violet-400"
          style={{ top: `${worldToScreen({ x: 0, y: guideY.value }, viewport).y}px` }}
        />
      )}

      {selected && selectedScreen && (
        <div
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
                class={
                  cropMode
                    ? 'absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white bg-amber-400'
                    : 'absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white bg-violet-500'
                }
                style={{ left: position.left, top: position.top, cursor: HANDLE_CURSOR[handle] }}
                onPointerDown={startResize(handle)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
