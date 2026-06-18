import type { Transform } from '@/lib/types'

// Convert a screen-space pixel delta to canvas-space pixels given the displayed
// size of the canvas element and the canvas backing-store size.
export function screenDeltaToCanvas(deltaPx: number, displayPx: number, canvasPx: number): number {
  if (displayPx <= 0) return deltaPx
  return (deltaPx / displayPx) * canvasPx
}

export function pointInTransform(canvasX: number, canvasY: number, transform: Transform): boolean {
  return (
    canvasX >= transform.x &&
    canvasX <= transform.x + transform.width &&
    canvasY >= transform.y &&
    canvasY <= transform.y + transform.height
  )
}
