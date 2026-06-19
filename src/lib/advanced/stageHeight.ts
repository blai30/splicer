// Bounds for the resizable Advanced preview work area (CSS px).
export const STAGE_MIN_HEIGHT = 320
export const STAGE_MAX_HEIGHT = 1600
export const STAGE_DEFAULT_HEIGHT = 480

export function clampStageHeight(value: number): number {
  return Math.min(STAGE_MAX_HEIGHT, Math.max(STAGE_MIN_HEIGHT, Math.round(value)))
}
