import type { Viewport } from '@/lib/types'

export type WorldRect = {
  minX: number
  minY: number
  width: number
  height: number
}

export const VIEWPORT_ZOOM_MIN = 0.05
export const VIEWPORT_ZOOM_MAX = 8

export function clampZoom(zoom: number): number {
  return Math.min(VIEWPORT_ZOOM_MAX, Math.max(VIEWPORT_ZOOM_MIN, zoom))
}

// world -> screen (CSS px relative to the stage top-left).
export function worldToScreen(
  point: { x: number; y: number },
  viewport: Viewport
): { x: number; y: number } {
  return {
    x: (point.x - viewport.panX) * viewport.zoom,
    y: (point.y - viewport.panY) * viewport.zoom,
  }
}

export function screenToWorld(
  point: { x: number; y: number },
  viewport: Viewport
): { x: number; y: number } {
  return {
    x: point.x / viewport.zoom + viewport.panX,
    y: point.y / viewport.zoom + viewport.panY,
  }
}

// Pan/zoom so a world-space rect is centered and framed within the stage, with
// uniform padding (CSS px) on every side. Empty/degenerate input resets to 1:1.
export function fitToContent(
  bounds: WorldRect | null,
  stage: { width: number; height: number },
  padding: number
): Viewport {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0 || stage.width <= 0 || stage.height <= 0) {
    return { panX: 0, panY: 0, zoom: 1 }
  }
  const usableWidth = Math.max(1, stage.width - padding * 2)
  const usableHeight = Math.max(1, stage.height - padding * 2)
  const zoom = clampZoom(Math.min(usableWidth / bounds.width, usableHeight / bounds.height))
  const worldCenterX = bounds.minX + bounds.width / 2
  const worldCenterY = bounds.minY + bounds.height / 2
  return {
    panX: worldCenterX - stage.width / (2 * zoom),
    panY: worldCenterY - stage.height / (2 * zoom),
    zoom,
  }
}

// Zoom while keeping the world point currently under `screenPoint` fixed.
export function zoomAtPoint(
  viewport: Viewport,
  screenPoint: { x: number; y: number },
  nextZoom: number
): Viewport {
  const zoom = clampZoom(nextZoom)
  const worldX = screenPoint.x / viewport.zoom + viewport.panX
  const worldY = screenPoint.y / viewport.zoom + viewport.panY
  return {
    panX: worldX - screenPoint.x / zoom,
    panY: worldY - screenPoint.y / zoom,
    zoom,
  }
}
