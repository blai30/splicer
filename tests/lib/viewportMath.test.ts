import { describe, expect, it } from 'vitest'

import {
  clampZoom,
  fitToContent,
  screenToWorld,
  VIEWPORT_ZOOM_MAX,
  VIEWPORT_ZOOM_MIN,
  worldToScreen,
  zoomAtPoint,
} from '@/lib/advanced/viewportMath'

describe('viewportMath', () => {
  const viewport = { panX: 100, panY: 50, zoom: 2 }

  it('round-trips world<->screen', () => {
    const world = { x: 300, y: 200 }
    const screen = worldToScreen(world, viewport)
    expect(screen).toEqual({ x: 400, y: 300 })
    expect(screenToWorld(screen, viewport)).toEqual(world)
  })

  it('clamps zoom to range', () => {
    expect(clampZoom(0.001)).toBe(VIEWPORT_ZOOM_MIN)
    expect(clampZoom(1000)).toBe(VIEWPORT_ZOOM_MAX)
    expect(clampZoom(1.5)).toBe(1.5)
  })

  it('fits content centered within the stage', () => {
    const bounds = { minX: 0, minY: 0, width: 800, height: 400 }
    const fitted = fitToContent(bounds, { width: 1000, height: 1000 }, 0)
    // width-limited: zoom = 1000/800 = 1.25
    expect(fitted.zoom).toBeCloseTo(1.25)
    // The bounds center maps to the stage center.
    const center = worldToScreen({ x: 400, y: 200 }, fitted)
    expect(center.x).toBeCloseTo(500)
    expect(center.y).toBeCloseTo(500)
  })

  it('returns identity viewport for empty bounds', () => {
    expect(fitToContent(null, { width: 800, height: 600 }, 12)).toEqual({
      panX: 0,
      panY: 0,
      zoom: 1,
    })
  })

  it('keeps the cursor world point fixed while zooming', () => {
    const screenPoint = { x: 250, y: 150 }
    const before = screenToWorld(screenPoint, viewport)
    const zoomed = zoomAtPoint(viewport, screenPoint, 4)
    expect(zoomed.zoom).toBe(4)
    const after = screenToWorld(screenPoint, zoomed)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })
})
