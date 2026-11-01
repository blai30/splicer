import { recordAdvancedHistory } from '@/lib/advanced/advancedHistory'
import { advancedSegments, advancedTracks } from '@/lib/store'
import type { Track } from '@/lib/types'

export function addTrack(): string {
  recordAdvancedHistory()
  const id = crypto.randomUUID()
  // Number after the highest existing "Track N" so names stay unique after
  // tracks are removed.
  let highest = 0
  for (const track of advancedTracks.value) {
    const match = /^Track (\d+)$/.exec(track.name)
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  const name = `Track ${Math.max(highest, advancedTracks.value.length) + 1}`
  // Insert at the top (front), since the top lane renders on top.
  advancedTracks.value = [{ id, name }, ...advancedTracks.value]
  return id
}

// The project always keeps at least one track so imports have a lane to land on.
export function removeTrack(id: string): void {
  if (advancedTracks.value.length <= 1) return
  if (!advancedTracks.value.some((track) => track.id === id)) return
  recordAdvancedHistory()
  advancedTracks.value = advancedTracks.value.filter((track) => track.id !== id)
  advancedSegments.value = advancedSegments.value.filter((segment) => segment.trackId !== id)
}

function patchTrack(id: string, patch: Partial<Track>): void {
  const track = advancedTracks.value.find((entry) => entry.id === id)
  if (!track) return
  const changed = (Object.keys(patch) as (keyof Track)[]).some((key) => track[key] !== patch[key])
  if (!changed) return
  recordAdvancedHistory()
  advancedTracks.value = advancedTracks.value.map((track) =>
    track.id === id ? { ...track, ...patch } : track
  )
}

export function renameTrack(id: string, name: string): void {
  patchTrack(id, { name })
}

export function setTrackMuted(id: string, muted: boolean): void {
  patchTrack(id, { muted })
}

export function setTrackHidden(id: string, hidden: boolean): void {
  patchTrack(id, { hidden })
}

export function moveTrack(id: string, direction: -1 | 1): void {
  const tracks = [...advancedTracks.value]
  const index = tracks.findIndex((track) => track.id === id)
  if (index === -1) return
  const target = index + direction
  if (target < 0 || target >= tracks.length) return
  recordAdvancedHistory()
  const [moved] = tracks.splice(index, 1)
  tracks.splice(target, 0, moved)
  advancedTracks.value = tracks
}
