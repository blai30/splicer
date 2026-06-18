import type { Transform } from '@/lib/types'

// Convert a screen-space pixel delta to a world-space pixel delta. One world
// pixel is drawn as `zoom` screen pixels, so screen px / zoom = world px.
export function screenDeltaToWorld(deltaPx: number, zoom: number): number {
  if (zoom <= 0) return deltaPx
  return deltaPx / zoom
}

export function pointInTransform(canvasX: number, canvasY: number, transform: Transform): boolean {
  return (
    canvasX >= transform.x &&
    canvasX <= transform.x + transform.width &&
    canvasY >= transform.y &&
    canvasY <= transform.y + transform.height
  )
}
