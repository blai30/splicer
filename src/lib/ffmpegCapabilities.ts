import type { ExportFormat, WebmCodec } from '@/lib/types'

export type CoreMode = 'multithread' | 'singlethread'

// Encode options threaded through the pure planner so it stays testable.
// threads === null means single-thread: omit all thread args.
// maxDimension caps the longest output side (used by OOM recovery to downscale).
export type EncodeOptions = {
  threads: number | null
  webmCodec: WebmCodec
  maxDimension?: number | null
}

const MAX_THREADS = 8

export function isolationAvailable(): boolean {
  return typeof globalThis !== 'undefined' && globalThis.crossOriginIsolated === true
}

export function computeThreadCount(): number {
  const hw = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined
  if (!hw || hw < 2) return 1
  return Math.min(hw, MAX_THREADS)
}

// Default encode options for a given core mode. Used by the execution layer.
export function encodeOptionsFor(mode: CoreMode, webmCodec: WebmCodec): EncodeOptions {
  return {
    threads: mode === 'multithread' ? computeThreadCount() : null,
    webmCodec,
    maxDimension: null,
  }
}

export type { ExportFormat, WebmCodec }
