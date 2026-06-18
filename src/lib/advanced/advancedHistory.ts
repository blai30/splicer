import { advancedSegments, advancedSelectedId, advancedTracks, clips } from '@/lib/store'
import type { AdvancedSegment, Clip, Track } from '@/lib/types'

// Every advanced edit routes a snapshot through this module so undo/redo see all
// of them: imports, moves, trims, cuts, in/out, mutes, deletes, transforms,
// crops, and track add/remove/reorder/mute/hide. Continuous drags record one
// entry per gesture via beginAdvancedGesture() + consumeAdvancedGesture().

const HISTORY_LIMIT = 20

type AdvancedHistoryEntry = {
  segments: AdvancedSegment[]
  tracks: Track[]
  selectedId: string | null
  clips: Clip[]
}

const history: AdvancedHistoryEntry[] = []
const redoHistory: AdvancedHistoryEntry[] = []

function captureEntry(): AdvancedHistoryEntry {
  return {
    segments: advancedSegments.value,
    tracks: advancedTracks.value,
    selectedId: advancedSelectedId.value,
    clips: clips.value,
  }
}

export function recordAdvancedHistory() {
  history.unshift(captureEntry())
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT
  // A new edit invalidates the redo branch.
  redoHistory.length = 0
}

// Continuous gestures (trim/move/resize/crop drags) record one history entry for
// the whole gesture: beginAdvancedGesture() arms the flag and the first mutation
// consumes it. In/Out actions reuse this path with a single armed mutation.
let gesturePending = false

export function beginAdvancedGesture() {
  gesturePending = true
}

export function consumeAdvancedGesture() {
  if (gesturePending) {
    gesturePending = false
    recordAdvancedHistory()
  }
}

function restoreEntry(entry: AdvancedHistoryEntry) {
  // Clips that exist now but not in the restored state (e.g. undoing an import)
  // lose their object URLs.
  for (const clip of clips.value) {
    if (!entry.clips.some((entryClip) => entryClip.id === clip.id)) {
      try {
        URL.revokeObjectURL(clip.objectUrl)
      } catch {
        // Best-effort
      }
    }
  }

  const restoredClips = entry.clips.map((entryClip) => {
    // Prefer the live clip when it survived: its object URL is still valid and it
    // may have gained waveform peaks since the snapshot.
    const liveClip = clips.value.find((clip) => clip.id === entryClip.id)
    if (liveClip) return liveClip
    // The clip was removed and its object URL revoked; recreate it from the
    // original File reference so the video plays again.
    return { ...entryClip, objectUrl: URL.createObjectURL(entryClip.file) }
  })

  advancedSegments.value = entry.segments
  advancedTracks.value = entry.tracks
  clips.value = restoredClips
  advancedSelectedId.value =
    entry.selectedId && entry.segments.some((segment) => segment.id === entry.selectedId)
      ? entry.selectedId
      : null
}

export function undoAdvanced() {
  const entry = history.shift()
  if (!entry) return
  redoHistory.unshift(captureEntry())
  if (redoHistory.length > HISTORY_LIMIT) redoHistory.length = HISTORY_LIMIT
  restoreEntry(entry)
}

export function redoAdvanced() {
  const entry = redoHistory.shift()
  if (!entry) return
  history.unshift(captureEntry())
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT
  restoreEntry(entry)
}

// Clears both stacks and any armed gesture. Used by tests for isolation.
export function resetAdvancedHistory() {
  history.length = 0
  redoHistory.length = 0
  gesturePending = false
}
