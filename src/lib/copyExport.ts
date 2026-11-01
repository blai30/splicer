import { computed, effect, signal } from '@preact/signals'

import { timelineCopyBlockers } from '@/lib/exportEngine'
import { planSliceCopyFromIndex, type PacketIndex } from '@/lib/fastCopy'
import { warn } from '@/lib/logger'
import {
  appMode,
  clips,
  exportFormat,
  framerate,
  getClipById,
  quality,
  resolution,
  timeline,
} from '@/lib/store'
import type { Clip } from '@/lib/types'

// The export panel's view of a stream copy ("Original (no re-encode)"):
// whether the timeline can be copied, and where its cuts land once snapped to
// key frames. Packet indexes are read lazily, only once Original is chosen.

export type PacketIndexState =
  | { status: 'loading' }
  | { status: 'ready'; index: PacketIndex }
  | { status: 'failed' }

export const packetIndexes = signal<ReadonlyMap<string, PacketIndexState>>(new Map())

function setIndexState(clipId: string, state: PacketIndexState) {
  const next = new Map(packetIndexes.value)
  next.set(clipId, state)
  packetIndexes.value = next
}

// A failed read is retried on the next call (the next timeline or setting
// change), so a transient error does not stick for the session.
export function ensurePacketIndex(clip: Clip): void {
  const state = packetIndexes.peek().get(clip.id)
  if (state && state.status !== 'failed') return
  setIndexState(clip.id, { status: 'loading' })
  // Loaded on demand: the packet reader pulls in mediabunny.
  import('@/lib/packetIndex')
    .then(({ readPacketIndex }) => readPacketIndex(clip.file))
    .then(
      (index) => setIndexState(clip.id, { status: 'ready', index }),
      (err: unknown) => {
        warn('Could not read key frames', {
          name: clip.name,
          message: err instanceof Error ? err.message : String(err),
        })
        setIndexState(clip.id, { status: 'failed' })
      }
    )
}

// Why the Basic timeline cannot be copied with the current settings. Reading
// clips keeps it current as probes finish (clip lookups are not signals).
export const copyBlockerReasons = computed(() => {
  void clips.value
  return timelineCopyBlockers(timeline.value, exportFormat.value, framerate.value, resolution.value)
})

export type SegmentCopyShift = {
  // Where the copy of this segment actually starts (a key frame), in source time.
  snappedStart: number
  // How much earlier than the in point that is; negative when the clip's
  // first key frame comes after it.
  shiftSec: number
}

export type CopyPreview =
  | { status: 'loading' }
  | { status: 'failed' }
  | {
      status: 'ready'
      shifts: ReadonlyMap<string, SegmentCopyShift>
      // Exact bytes of the video packets the copy writes.
      videoBytes: number
      durationSec: number
      maxShiftSec: number
    }

// null unless Original is chosen and the timeline can be copied.
export const copyPreview = computed<CopyPreview | null>(() => {
  if (appMode.value !== 'basic' || quality.value !== 'original') return null
  if (copyBlockerReasons.value.length > 0) return null
  const indexes = packetIndexes.value
  const shifts = new Map<string, SegmentCopyShift>()
  let videoBytes = 0
  let durationSec = 0
  let maxShiftSec = 0
  for (const segment of timeline.value) {
    const state = indexes.get(segment.clipId)
    if (!state || state.status === 'loading') return { status: 'loading' }
    if (state.status === 'failed') return { status: 'failed' }
    const plan = planSliceCopyFromIndex(state.index, segment.startTime, segment.endTime)
    if (!plan) return { status: 'failed' }
    const shiftSec = segment.startTime - plan.snappedStart
    shifts.set(segment.id, { snappedStart: plan.snappedStart, shiftSec })
    videoBytes += plan.byteLength
    durationSec += plan.end - plan.snappedStart
    maxShiftSec = Math.max(maxShiftSec, shiftSec)
  }
  return { status: 'ready', shifts, videoBytes, durationSec, maxShiftSec }
})

// Read key frames once Original is chosen for a timeline that can be copied.
effect(() => {
  if (appMode.value !== 'basic' || quality.value !== 'original') return
  if (copyBlockerReasons.value.length > 0) return
  for (const segment of timeline.value) {
    const clip = getClipById(segment.clipId)
    if (clip) ensurePacketIndex(clip)
  }
})
