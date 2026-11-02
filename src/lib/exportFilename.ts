import type { ExportFormat } from '@/lib/types'

// "splicer-2026-11-02T07-18-00.mp4". A per-segment export shares one timestamp
// so its files sort together, and numbers each part from 1, padded to the
// count's width ("-part-03" of 12).
export function makeExportFilename(
  format: ExportFormat,
  date: Date,
  part?: { index: number; count: number }
): string {
  const timestamp = date
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\.\d{3}Z$/, '')
  const suffix = part
    ? `-part-${String(part.index + 1).padStart(String(part.count).length, '0')}`
    : ''
  return `splicer-${timestamp}${suffix}.${format}`
}
