// Fade envelope shared by the preview (canvas alpha, element volume) and the
// export (compositor layer alpha, audio mix gain), so both render the same
// ramps. Imports nothing, so the export workers can use it.

export type FadedSpan = {
  sourceStart: number
  sourceEnd: number
  // Seconds; missing means no fade.
  fadeIn?: number
  fadeOut?: number
}

// Fades as they apply to a span of `duration`: each is at least 0, and when
// together they would outlast the clip (after a trim shortened it) both shrink
// in proportion, so the ramps meet instead of overlapping.
export function effectiveFades(span: FadedSpan): { fadeIn: number; fadeOut: number } {
  const duration = Math.max(0, span.sourceEnd - span.sourceStart)
  const fadeIn = Math.max(0, span.fadeIn ?? 0)
  const fadeOut = Math.max(0, span.fadeOut ?? 0)
  const total = fadeIn + fadeOut
  if (total <= duration || total === 0) return { fadeIn, fadeOut }
  const scale = duration / total
  return { fadeIn: fadeIn * scale, fadeOut: fadeOut * scale }
}

// Linear fade gain (0..1) at `localTime` seconds into the span.
export function segmentGainAt(span: FadedSpan, localTime: number): number {
  const { fadeIn, fadeOut } = effectiveFades(span)
  if (fadeIn === 0 && fadeOut === 0) return 1
  const duration = Math.max(0, span.sourceEnd - span.sourceStart)
  const gainIn = fadeIn > 0 ? localTime / fadeIn : 1
  const gainOut = fadeOut > 0 ? (duration - localTime) / fadeOut : 1
  return Math.min(1, Math.max(0, Math.min(gainIn, gainOut)))
}

export function hasFades(span: FadedSpan): boolean {
  return (span.fadeIn ?? 0) > 0 || (span.fadeOut ?? 0) > 0
}
