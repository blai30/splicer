// Distance kept from the viewport edges.
export const VIEWPORT_MARGIN_PX = 8

// Where a floating menu's top-left goes so all of it stays on screen: below
// and right of the anchor when it fits, otherwise flipped above or left of it,
// and clamped inside the margins either way.
export function placeMenu(
  anchor: { x: number; y: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = VIEWPORT_MARGIN_PX
): { left: number; top: number } {
  const fitsRight = anchor.x + menu.width <= viewport.width - margin
  const fitsBelow = anchor.y + menu.height <= viewport.height - margin
  const left = fitsRight ? anchor.x : anchor.x - menu.width
  const top = fitsBelow ? anchor.y : anchor.y - menu.height
  return {
    left: Math.max(margin, Math.min(left, viewport.width - menu.width - margin)),
    top: Math.max(margin, Math.min(top, viewport.height - menu.height - margin)),
  }
}
