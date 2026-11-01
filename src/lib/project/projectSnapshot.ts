import type { AdvancedSegment, Clip, Segment, Track } from '@/lib/types'

// The saved project: plain data that IndexedDB stores by structured clone. The
// source Files are stored separately, once per clip id, so autosaving an edit
// rewrites only this small record. Bump the version on any shape change;
// parseProjectRecord drops records it does not understand.
export const PROJECT_SCHEMA_VERSION = 1

// A clip without its live File and object URL. The file details let a clip
// whose media is missing be named and relinked.
export type StoredClip = Omit<Clip, 'file' | 'objectUrl'> & {
  fileName: string
  fileSize: number
  fileType: string
}

// A clip whose media could not be restored, with the segments that used it,
// kept aside until the user relinks the file or removes them.
export type UnlinkedClip = {
  clip: StoredClip
  // Where each Basic segment sat in the timeline when it was set aside.
  basic: { index: number; segment: Segment }[]
  advanced: AdvancedSegment[]
}

export type ProjectRecord = {
  version: typeof PROJECT_SCHEMA_VERSION
  savedAt: number
  timeline: Segment[]
  selectedSegmentId: string | null
  advancedTracks: Track[]
  advancedSegments: AdvancedSegment[]
  clips: StoredClip[]
  unlinked: UnlinkedClip[]
}

export type ProjectState = {
  timeline: Segment[]
  selectedSegmentId: string | null
  advancedTracks: Track[]
  advancedSegments: AdvancedSegment[]
  clips: Clip[]
  unlinked: UnlinkedClip[]
}

export function toStoredClip(clip: Clip): StoredClip {
  const { file, objectUrl: _objectUrl, ...rest } = clip
  return { ...rest, fileName: file.name, fileSize: file.size, fileType: file.type }
}

// The clips the live project uses, in pool (import) order. Clips only undo
// history or the clipboard can reach are not saved: neither survives a reload.
export function projectClips(state: Omit<ProjectState, 'unlinked'>): Clip[] {
  const used = new Set<string>()
  for (const segment of state.timeline) used.add(segment.clipId)
  for (const segment of state.advancedSegments) used.add(segment.clipId)
  return state.clips.filter((clip) => used.has(clip.id))
}

export function hasProjectContent(state: {
  timeline: readonly unknown[]
  advancedSegments: readonly unknown[]
  unlinked: readonly unknown[]
}): boolean {
  return state.timeline.length > 0 || state.advancedSegments.length > 0 || state.unlinked.length > 0
}

export function buildProjectRecord(state: ProjectState, savedAt: number): ProjectRecord {
  return {
    version: PROJECT_SCHEMA_VERSION,
    savedAt,
    timeline: state.timeline,
    selectedSegmentId: state.selectedSegmentId,
    advancedTracks: state.advancedTracks,
    advancedSegments: state.advancedSegments,
    clips: projectClips(state).map(toStoredClip),
    unlinked: state.unlinked,
  }
}

// Which clip files to keep in storage: in import order until the byte budget
// runs out, so a later huge file never pushes out earlier ones. The rest are
// saved as details only and need relinking after a reload.
export function planMediaStorage(
  clips: readonly Clip[],
  budgetBytes: number
): { kept: Clip[]; skipped: Clip[] } {
  const kept: Clip[] = []
  const skipped: Clip[] = []
  let used = 0
  for (const clip of clips) {
    if (used + clip.file.size <= budgetBytes) {
      kept.push(clip)
      used += clip.file.size
    } else {
      skipped.push(clip)
    }
  }
  return { kept, skipped }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const isString = (value: unknown): value is string => typeof value === 'string'

function isSegment(value: unknown): value is Segment {
  return (
    isObject(value) &&
    isString(value.id) &&
    isString(value.clipId) &&
    isFiniteNumber(value.startTime) &&
    isFiniteNumber(value.endTime) &&
    value.endTime > value.startTime
  )
}

function isAdvancedSegment(value: unknown): value is AdvancedSegment {
  if (!isObject(value) || !isObject(value.transform)) return false
  const transform = value.transform
  return (
    isString(value.id) &&
    isString(value.clipId) &&
    isString(value.trackId) &&
    isFiniteNumber(value.timelineStart) &&
    isFiniteNumber(value.sourceStart) &&
    isFiniteNumber(value.sourceEnd) &&
    value.sourceEnd > value.sourceStart &&
    isFiniteNumber(transform.x) &&
    isFiniteNumber(transform.y) &&
    isFiniteNumber(transform.width) &&
    isFiniteNumber(transform.height)
  )
}

function isTrack(value: unknown): value is Track {
  return isObject(value) && isString(value.id) && isString(value.name)
}

function isStoredClip(value: unknown): value is StoredClip {
  return (
    isObject(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isString(value.fileName) &&
    isFiniteNumber(value.fileSize) &&
    isFiniteNumber(value.duration) &&
    value.duration > 0 &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height)
  )
}

function storedClipOrNull(value: unknown): StoredClip | null {
  if (!isStoredClip(value)) return null
  // Peaks only draw the waveform; anything unexpected is re-extracted.
  const waveformPeaks =
    value.waveformPeaks instanceof Float32Array ? value.waveformPeaks : new Float32Array(0)
  return { ...value, fileType: isString(value.fileType) ? value.fileType : '', waveformPeaks }
}

function unlinkedOrNull(value: unknown): UnlinkedClip | null {
  if (!isObject(value)) return null
  const clip = storedClipOrNull(value.clip)
  if (!clip || !Array.isArray(value.basic) || !Array.isArray(value.advanced)) return null
  const basic = value.basic.filter(
    (entry): entry is UnlinkedClip['basic'][number] =>
      isObject(entry) &&
      isFiniteNumber(entry.index) &&
      isSegment(entry.segment) &&
      entry.segment.clipId === clip.id
  )
  const advanced = value.advanced.filter(
    (segment): segment is AdvancedSegment =>
      isAdvancedSegment(segment) && segment.clipId === clip.id
  )
  return basic.length > 0 || advanced.length > 0 ? { clip, basic, advanced } : null
}

// A record read back from storage, checked piece by piece: a malformed entry is
// dropped instead of failing the whole project, and segments whose clip is
// unknown go with it. Null when the record is not a project this version reads.
export function parseProjectRecord(value: unknown): ProjectRecord | null {
  if (!isObject(value) || value.version !== PROJECT_SCHEMA_VERSION) return null
  const clips = (Array.isArray(value.clips) ? value.clips : [])
    .map(storedClipOrNull)
    .filter((clip): clip is StoredClip => clip !== null)
  const clipIds = new Set(clips.map((clip) => clip.id))
  const tracks = (Array.isArray(value.advancedTracks) ? value.advancedTracks : []).filter(isTrack)
  const trackIds = new Set(tracks.map((track) => track.id))
  const timeline = (Array.isArray(value.timeline) ? value.timeline : []).filter(
    (segment): segment is Segment => isSegment(segment) && clipIds.has(segment.clipId)
  )
  const advancedSegments = (
    Array.isArray(value.advancedSegments) ? value.advancedSegments : []
  ).filter(
    (segment): segment is AdvancedSegment =>
      isAdvancedSegment(segment) && clipIds.has(segment.clipId) && trackIds.has(segment.trackId)
  )
  const unlinked = (Array.isArray(value.unlinked) ? value.unlinked : [])
    .map(unlinkedOrNull)
    .filter((entry): entry is UnlinkedClip => entry !== null)
  const selectedSegmentId =
    isString(value.selectedSegmentId) &&
    timeline.some((segment) => segment.id === value.selectedSegmentId)
      ? value.selectedSegmentId
      : (timeline[0]?.id ?? null)
  return {
    version: PROJECT_SCHEMA_VERSION,
    savedAt: isFiniteNumber(value.savedAt) ? value.savedAt : 0,
    timeline,
    selectedSegmentId,
    advancedTracks: tracks,
    advancedSegments,
    clips,
    unlinked,
  }
}

export type RestorePlan = {
  timeline: Segment[]
  selectedSegmentId: string | null
  advancedTracks: Track[]
  advancedSegments: AdvancedSegment[]
  // Stored clips whose file came back, paired with it.
  restored: { clip: StoredClip; file: File }[]
  unlinked: UnlinkedClip[]
}

export const DEFAULT_TRACKS: Track[] = [{ id: 'track-1', name: 'Track 1' }]

// Split a saved project by which clip files came back. Segments of a missing
// file are set aside with their positions so relinking can put them back.
export function planRestore(record: ProjectRecord, files: ReadonlyMap<string, File>): RestorePlan {
  const restored: RestorePlan['restored'] = []
  const missing = new Map<string, UnlinkedClip>()
  for (const clip of record.clips) {
    const file = files.get(clip.id)
    if (file) restored.push({ clip, file })
    else missing.set(clip.id, { clip, basic: [], advanced: [] })
  }
  const timeline: Segment[] = []
  for (const [index, segment] of record.timeline.entries()) {
    const unlinked = missing.get(segment.clipId)
    if (unlinked) unlinked.basic.push({ index, segment })
    else timeline.push(segment)
  }
  const advancedSegments: AdvancedSegment[] = []
  for (const segment of record.advancedSegments) {
    const unlinked = missing.get(segment.clipId)
    if (unlinked) unlinked.advanced.push(segment)
    else advancedSegments.push(segment)
  }
  const selectedSegmentId = timeline.some((segment) => segment.id === record.selectedSegmentId)
    ? record.selectedSegmentId
    : (timeline[0]?.id ?? null)
  const nowMissing = [...missing.values()].filter(
    (entry) => entry.basic.length > 0 || entry.advanced.length > 0
  )
  return {
    timeline,
    selectedSegmentId,
    advancedTracks: record.advancedTracks.length > 0 ? record.advancedTracks : DEFAULT_TRACKS,
    advancedSegments,
    restored,
    unlinked: [...record.unlinked, ...nowMissing],
  }
}

// Put a relinked clip's Basic segments back at their saved positions, clamped
// to the timeline as it is. A timeline that already holds them is returned
// unchanged, so applying this to every undo snapshot is safe.
export function reinsertUnlinkedBasic(
  unlinked: UnlinkedClip,
  timeline: readonly Segment[]
): Segment[] {
  const ids = new Set(unlinked.basic.map(({ segment }) => segment.id))
  if (timeline.some((segment) => ids.has(segment.id))) return [...timeline]
  const nextTimeline = [...timeline]
  const ordered = [...unlinked.basic].sort((first, second) => first.index - second.index)
  for (const { index, segment } of ordered) {
    nextTimeline.splice(Math.min(Math.max(0, index), nextTimeline.length), 0, segment)
  }
  return nextTimeline
}

// Put a relinked clip's Advanced segments back on their track, or the top
// track when theirs was removed meanwhile. Idempotent like the Basic one.
export function reinsertUnlinkedAdvanced(
  unlinked: UnlinkedClip,
  advancedSegments: readonly AdvancedSegment[],
  tracks: readonly Track[]
): AdvancedSegment[] {
  const ids = new Set(unlinked.advanced.map((segment) => segment.id))
  if (advancedSegments.some((segment) => ids.has(segment.id))) return [...advancedSegments]
  const trackIds = new Set(tracks.map((track) => track.id))
  const fallbackTrack = tracks[0]?.id ?? DEFAULT_TRACKS[0].id
  const placed = unlinked.advanced.map((segment) =>
    trackIds.has(segment.trackId) ? segment : { ...segment, trackId: fallbackTrack }
  )
  return [...advancedSegments, ...placed]
}

// Whether a file picked to relink is plausibly the original: the trims are in
// source time, so a different duration or frame size would cut the wrong
// frames. Returns the reason when it is not.
export function relinkMismatch(
  stored: Pick<StoredClip, 'duration' | 'width' | 'height'>,
  candidate: Pick<Clip, 'duration' | 'width' | 'height'>
): string | null {
  const tolerance = Math.max(0.5, stored.duration * 0.02)
  if (Math.abs(candidate.duration - stored.duration) > tolerance) {
    return `its length (${candidate.duration.toFixed(1)} s) differs from the original (${stored.duration.toFixed(1)} s)`
  }
  if (candidate.width !== stored.width || candidate.height !== stored.height) {
    return `its size (${candidate.width}×${candidate.height}) differs from the original (${stored.width}×${stored.height})`
  }
  return null
}
