import { batch } from '@preact/signals'

import { recordAdvancedHistory } from '@/lib/advanced/advancedHistory'
import {
  advancedCanvas,
  advancedCanvasAuto,
  advancedPlayhead,
  advancedSegments,
  advancedSelectedId,
  DEFAULT_CANVAS,
} from '@/lib/store'

export const CANVAS_MIN = 16
export const CANVAS_MAX = 7680

// Codecs reject odd dimensions for yuv420; clamp to an even integer in range.
function clampDimension(value: number): number {
  const bounded = Math.min(CANVAS_MAX, Math.max(CANVAS_MIN, Math.round(value)))
  return bounded % 2 === 0 ? bounded : bounded - 1
}

// Resize the output canvas. Placed clips keep their transforms (absolute canvas
// pixels), so changing the canvas does not move or resize them; the user
// repositions clips manually if desired. A manual size also turns Auto off.
export function setCanvasSize(width: number, height: number): void {
  batch(() => {
    advancedCanvasAuto.value = false
    advancedCanvas.value = { width: clampDimension(width), height: clampDimension(height) }
  })
}

// Auto sizing: fit the canvas to the tight bounding box of every placed clip's
// transform rect, shifting content flush to the top-left so there is no margin.
// A no-op unless Auto is on; called at edit-commit points (clip add/remove, the
// end of a move/resize/crop gesture), never mid-gesture.
export function recomputeAutoCanvas(): void {
  if (!advancedCanvasAuto.value) return
  const segments = advancedSegments.value
  if (segments.length === 0) {
    advancedCanvas.value = DEFAULT_CANVAS
    return
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const segment of segments) {
    const { x, y, width, height } = segment.transform
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + width)
    maxY = Math.max(maxY, y + height)
  }
  batch(() => {
    advancedSegments.value = segments.map((segment) => ({
      ...segment,
      transform: {
        ...segment.transform,
        x: segment.transform.x - minX,
        y: segment.transform.y - minY,
      },
    }))
    advancedCanvas.value = {
      width: clampDimension(maxX - minX),
      height: clampDimension(maxY - minY),
    }
  })
}

// Turn Auto on and size the canvas to the placed content. Records one history
// entry first because the recompute shifts transforms and changes the canvas.
export function enableAutoCanvas(): void {
  recordAdvancedHistory()
  advancedCanvasAuto.value = true
  recomputeAutoCanvas()
}

export function clearAdvancedClip(): void {
  advancedSegments.value = []
  advancedSelectedId.value = null
  advancedPlayhead.value = 0
}
