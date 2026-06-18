import { batch, useSignal } from '@preact/signals'

import {
  selectAdvancedSegment,
  setSegmentCrop,
  setSegmentTransform,
} from '@/lib/advanced/advancedSegmentEditing'
import { segmentsActiveAt, orderedForRender } from '@/lib/advanced/advancedTimelineDomain'
import { pointInTransform, screenDeltaToCanvas } from '@/lib/advanced/canvasCoords'
import { defaultCrop, resizeCropWithBox } from '@/lib/advanced/cropMath'
import { snapCandidates, snapMove } from '@/lib/advanced/snapMath'
import { RESIZE_HANDLES, resizeTransform, type ResizeHandle } from '@/lib/advanced/transformMath'
import {
  advancedCanvas,
  advancedPlayhead,
  advancedSegments,
  advancedSelectedId,
  advancedTracks,
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

  const canvas = advancedCanvas.value
  const selectedId = advancedSelectedId.value
  const selected = advancedSegments.value.find((segment) => segment.id === selectedId) ?? null

  function wrapperWidth(target: HTMLElement): number {
    const wrapper = target.closest('[data-canvas-wrapper]') as HTMLElement | null
    return wrapper?.getBoundingClientRect().width ?? 0
  }
  function wrapperHeight(target: HTMLElement): number {
    const wrapper = target.closest('[data-canvas-wrapper]') as HTMLElement | null
    return wrapper?.getBoundingClientRect().height ?? 0
  }

  // Click on empty canvas selects the top-most active clip under the pointer.
  function onBackgroundPointerDown(event: PointerEvent) {
    const wrapper = event.currentTarget as HTMLElement
    const rect = wrapper.getBoundingClientRect()
    const canvasX = ((event.clientX - rect.left) / rect.width) * canvas.width
    const canvasY = ((event.clientY - rect.top) / rect.height) * canvas.height
    const active = segmentsActiveAt(advancedSegments.value, advancedPlayhead.value)
    const topFirst = orderedForRender(active, advancedTracks.value).reverse()
    const hit = topFirst.find((segment) => pointInTransform(canvasX, canvasY, segment.transform))
    selectAdvancedSegment(hit ? hit.id : '')
  }

  function startMove(event: PointerEvent) {
    if (!selected || cropMode) return
    const active = selected
    event.stopPropagation()
    const element = event.currentTarget as HTMLElement
    element.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startY = event.clientY
    const startTransform = active.transform
    const displayW = wrapperWidth(element)
    const displayH = wrapperHeight(element)
    const others = advancedSegments.value
      .filter((segment) => segment.id !== active.id)
      .map((segment) => segment.transform)
    const candidates = snapCandidates(canvas, others)

    function onMove(moveEvent: PointerEvent) {
      const dx = screenDeltaToCanvas(moveEvent.clientX - startX, displayW, canvas.width)
      const dy = screenDeltaToCanvas(moveEvent.clientY - startY, displayH, canvas.height)
      const moved: Transform = {
        ...startTransform,
        x: startTransform.x + dx,
        y: startTransform.y + dy,
      }
      const snapped = snapMove(moved, candidates, SNAP_THRESHOLD)
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
      const startX = event.clientX
      const startY = event.clientY
      const startTransform = active.transform
      const clip = getClipById(active.clipId)
      const startCrop = active.crop ?? (clip ? defaultCrop(clip.width, clip.height) : null)
      const displayW = wrapperWidth(element)
      const displayH = wrapperHeight(element)

      function onMove(moveEvent: PointerEvent) {
        const dx = screenDeltaToCanvas(moveEvent.clientX - startX, displayW, canvas.width)
        const dy = screenDeltaToCanvas(moveEvent.clientY - startY, displayH, canvas.height)
        if (cropMode && clip && startCrop) {
          // Map the canvas-space drag into source pixels via the transform box scale.
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

  return (
    <div
      class="absolute inset-0 z-10"
      style={{ cursor: cropMode ? 'crosshair' : 'default' }}
      onPointerDown={onBackgroundPointerDown}
    >
      {guideX.value !== null && (
        <div
          class="pointer-events-none absolute top-0 bottom-0 w-px bg-violet-400"
          style={{ left: `${(guideX.value / canvas.width) * 100}%` }}
        />
      )}
      {guideY.value !== null && (
        <div
          class="pointer-events-none absolute right-0 left-0 h-px bg-violet-400"
          style={{ top: `${(guideY.value / canvas.height) * 100}%` }}
        />
      )}

      {selected && (
        <div
          class={
            cropMode
              ? 'absolute border-2 border-dashed border-amber-400'
              : 'absolute border border-violet-400'
          }
          style={{
            left: `${(selected.transform.x / canvas.width) * 100}%`,
            top: `${(selected.transform.y / canvas.height) * 100}%`,
            width: `${(selected.transform.width / canvas.width) * 100}%`,
            height: `${(selected.transform.height / canvas.height) * 100}%`,
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
