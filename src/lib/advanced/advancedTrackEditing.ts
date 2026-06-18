import { recordAdvancedHistory } from '@/lib/advanced/advancedHistory'
import { advancedSegments, advancedTracks } from '@/lib/store'
import type { Track } from '@/lib/types'

export function addTrack(): string {
  recordAdvancedHistory()
  const id = crypto.randomUUID()
  const name = `Track ${advancedTracks.value.length + 1}`
  // Insert at the top (front), since the top lane renders on top.
  advancedTracks.value = [{ id, name }, ...advancedTracks.value]
  return id
}

export function removeTrack(id: string): void {
  recordAdvancedHistory()
  advancedTracks.value = advancedTracks.value.filter((track) => track.id !== id)
  advancedSegments.value = advancedSegments.value.filter((segment) => segment.trackId !== id)
}

function patchTrack(id: string, patch: Partial<Track>): void {
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
