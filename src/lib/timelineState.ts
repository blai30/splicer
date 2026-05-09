import { signal } from '@preact/signals'

import { timeline } from '@/lib/store'

export const ZOOM_MIN = 20
export const ZOOM_MAX = 200
export const GAP_PX = 4
export const PADDING_PX = 12

export interface DragState {
  segId: string
  dropIndex: number
}

export const pxPerSec = signal(80)
export const dragState = signal<DragState | null>(null)

export function clipColor(clipId: string): string {
  const colors = ['bg-violet-700', 'bg-teal-700', 'bg-cyan-700', 'bg-emerald-700', 'bg-sky-700']
  let hash = 0
  for (let i = 0; i < clipId.length; i++) hash = (hash * 31 + clipId.charCodeAt(i)) | 0
  return colors[Math.abs(hash) % colors.length]
}

export function getSegmentStartX(segId: string): number {
  let x = PADDING_PX
  for (const seg of timeline.value) {
    if (seg.id === segId) return x
    x += (seg.endTime - seg.startTime) * pxPerSec.value + GAP_PX
  }
  return PADDING_PX
}
