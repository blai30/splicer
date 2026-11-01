import type { Resolution } from '../types'

// The shorter side each resolution choice caps the output at. The shorter
// side, so a portrait 1080x1920 clip counts as 1080p, as video sites label it.
export const RESOLUTION_SHORT_SIDE: Record<Exclude<Resolution, 'original'>, number> = {
  '1080': 1080,
  '720': 720,
  '480': 480,
  '360': 360,
}

// Largest first, for picking the biggest size that still fits a constraint.
export const STANDARD_SHORT_SIDES = [1080, 720, 480, 360] as const

export function resolutionShortSide(resolution: Resolution): number | null {
  return resolution === 'original' ? null : RESOLUTION_SHORT_SIDE[resolution]
}

// Codecs reject odd dimensions for yuv420; floor to even (minimum 2).
export function evenFloor(value: number): number {
  const floored = Math.max(2, Math.floor(value))
  return floored % 2 === 0 ? floored : floored - 1
}

export type Size = { width: number; height: number }

// Scale a frame down so its shorter side is at most `maxShortSide`, keeping
// the aspect ratio, with even dimensions. Never scales up; null keeps the size.
export function capShortSide(size: Size, maxShortSide: number | null | undefined): Size {
  const shortSide = Math.min(size.width, size.height)
  if (!maxShortSide || shortSide <= maxShortSide || shortSide <= 0) {
    return { width: evenFloor(size.width), height: evenFloor(size.height) }
  }
  const scale = maxShortSide / shortSide
  // Round rather than floor before evening, so 1920x1080 -> 640x360 exactly.
  return {
    width: evenFloor(Math.round(size.width * scale)),
    height: evenFloor(Math.round(size.height * scale)),
  }
}

// The standard sizes below a frame's own, largest first: the choices that
// would actually shrink it.
export function smallerStandardSides(size: Size): number[] {
  const shortSide = Math.min(size.width, size.height)
  return STANDARD_SHORT_SIDES.filter((side) => side < shortSide)
}
