import { describe, expect, it } from 'vitest'

import {
  buildProjectRecord,
  DEFAULT_TRACKS,
  hasProjectContent,
  parseProjectRecord,
  planMediaStorage,
  planRestore,
  PROJECT_SCHEMA_VERSION,
  reinsertUnlinkedAdvanced,
  reinsertUnlinkedBasic,
  relinkMismatch,
  toStoredClip,
  type ProjectRecord,
  type ProjectState,
} from '@/lib/project/projectSnapshot'
import type { AdvancedSegment, Clip, Segment } from '@/lib/types'

function makeClip(id: string, bytes = 10): Clip {
  return {
    id,
    file: new File([new Uint8Array(bytes)], `${id}.mp4`, { type: 'video/mp4' }),
    name: id,
    duration: 10,
    width: 640,
    height: 360,
    objectUrl: `blob:${id}`,
    waveformPeaks: new Float32Array([0.1, 0.5]),
    hasAudio: true,
  }
}

const segment = (id: string, clipId: string, startTime = 0, endTime = 5): Segment => ({
  id,
  clipId,
  startTime,
  endTime,
})

const advancedSegment = (id: string, clipId: string, trackId = 'track-1'): AdvancedSegment => ({
  id,
  clipId,
  trackId,
  timelineStart: 0,
  sourceStart: 0,
  sourceEnd: 4,
  transform: { x: 0, y: 0, width: 640, height: 360 },
})

function state(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    timeline: [],
    selectedSegmentId: null,
    advancedTracks: DEFAULT_TRACKS,
    advancedSegments: [],
    clips: [],
    unlinked: [],
    ...overrides,
  }
}

describe('toStoredClip', () => {
  it('drops the File and object URL and keeps the file details', () => {
    const stored = toStoredClip(makeClip('a', 42))
    expect(stored).not.toHaveProperty('file')
    expect(stored).not.toHaveProperty('objectUrl')
    expect(stored).toMatchObject({
      id: 'a',
      fileName: 'a.mp4',
      fileSize: 42,
      fileType: 'video/mp4',
    })
    expect(stored.waveformPeaks).toEqual(new Float32Array([0.1, 0.5]))
  })
})

describe('buildProjectRecord', () => {
  it('saves only clips the live project uses', () => {
    const record = buildProjectRecord(
      state({
        clips: [makeClip('basic'), makeClip('history-only'), makeClip('advanced')],
        timeline: [segment('s1', 'basic')],
        advancedSegments: [advancedSegment('a1', 'advanced')],
      }),
      123
    )
    expect(record.version).toBe(PROJECT_SCHEMA_VERSION)
    expect(record.savedAt).toBe(123)
    expect(record.clips.map((clip) => clip.id)).toEqual(['basic', 'advanced'])
  })

  it('round-trips through parseProjectRecord', () => {
    const record = buildProjectRecord(
      state({
        clips: [makeClip('a')],
        timeline: [segment('s1', 'a'), segment('s2', 'a', 5, 9)],
        selectedSegmentId: 's2',
        advancedSegments: [advancedSegment('x', 'a')],
      }),
      5
    )
    expect(parseProjectRecord(structuredClone(record))).toEqual(record)
  })
})

describe('hasProjectContent', () => {
  it('is true for any segment in either editor or any clip awaiting relink', () => {
    expect(hasProjectContent(state())).toBe(false)
    expect(hasProjectContent(state({ timeline: [segment('s', 'a')] }))).toBe(true)
    expect(hasProjectContent(state({ advancedSegments: [advancedSegment('x', 'a')] }))).toBe(true)
  })
})

describe('planMediaStorage', () => {
  it('keeps files in import order until the budget runs out', () => {
    const clips = [makeClip('a', 40), makeClip('huge', 100), makeClip('b', 50)]
    const { kept, skipped } = planMediaStorage(clips, 100)
    expect(kept.map((clip) => clip.id)).toEqual(['a', 'b'])
    expect(skipped.map((clip) => clip.id)).toEqual(['huge'])
  })

  it('keeps everything within budget', () => {
    expect(planMediaStorage([makeClip('a', 5)], 5).skipped).toEqual([])
  })
})

describe('parseProjectRecord', () => {
  const valid = (): ProjectRecord =>
    buildProjectRecord(
      state({
        clips: [makeClip('a')],
        timeline: [segment('s1', 'a')],
        selectedSegmentId: 's1',
        advancedSegments: [advancedSegment('x', 'a')],
      }),
      1
    )

  it('rejects other versions and non-objects', () => {
    expect(parseProjectRecord(null)).toBeNull()
    expect(parseProjectRecord('project')).toBeNull()
    expect(parseProjectRecord({ ...valid(), version: 999 })).toBeNull()
  })

  it('drops malformed entries and segments whose clip or track is unknown', () => {
    const record = valid()
    const parsed = parseProjectRecord({
      ...record,
      clips: [...record.clips, { id: 'broken' }],
      timeline: [...record.timeline, segment('orphan', 'missing'), { id: 'bad' }],
      advancedSegments: [
        ...record.advancedSegments,
        advancedSegment('lost-track', 'a', 'no-such-track'),
        { ...advancedSegment('inverted', 'a'), sourceEnd: -1 },
      ],
    })
    expect(parsed?.clips.map((clip) => clip.id)).toEqual(['a'])
    expect(parsed?.timeline.map((entry) => entry.id)).toEqual(['s1'])
    expect(parsed?.advancedSegments.map((entry) => entry.id)).toEqual(['x'])
  })

  it('replaces unreadable waveform peaks and falls back to the first segment selection', () => {
    const record = valid()
    const parsed = parseProjectRecord({
      ...record,
      selectedSegmentId: 'gone',
      clips: [{ ...record.clips[0], waveformPeaks: [1, 2] }],
    })
    expect(parsed?.clips[0].waveformPeaks).toEqual(new Float32Array(0))
    expect(parsed?.selectedSegmentId).toBe('s1')
  })
})

describe('planRestore', () => {
  const record = (): ProjectRecord =>
    buildProjectRecord(
      state({
        clips: [makeClip('kept'), makeClip('lost')],
        timeline: [segment('s1', 'kept'), segment('s2', 'lost'), segment('s3', 'kept')],
        selectedSegmentId: 's2',
        advancedSegments: [advancedSegment('x', 'lost'), advancedSegment('y', 'kept')],
      }),
      1
    )

  it('restores everything when every file comes back', () => {
    const files = new Map([
      ['kept', new File([], 'kept.mp4')],
      ['lost', new File([], 'lost.mp4')],
    ])
    const plan = planRestore(record(), files)
    expect(plan.timeline.map((entry) => entry.id)).toEqual(['s1', 's2', 's3'])
    expect(plan.selectedSegmentId).toBe('s2')
    expect(plan.unlinked).toEqual([])
    expect(plan.restored.map((entry) => entry.clip.id)).toEqual(['kept', 'lost'])
  })

  it('sets a missing file’s segments aside with their positions', () => {
    const plan = planRestore(record(), new Map([['kept', new File([], 'kept.mp4')]]))
    expect(plan.timeline.map((entry) => entry.id)).toEqual(['s1', 's3'])
    expect(plan.advancedSegments.map((entry) => entry.id)).toEqual(['y'])
    expect(plan.selectedSegmentId).toBe('s1')
    expect(plan.unlinked).toHaveLength(1)
    expect(plan.unlinked[0].clip.id).toBe('lost')
    expect(plan.unlinked[0].basic).toEqual([{ index: 1, segment: segment('s2', 'lost') }])
    expect(plan.unlinked[0].advanced.map((entry) => entry.id)).toEqual(['x'])
  })

  it('falls back to the default track list when none was saved', () => {
    const plan = planRestore({ ...record(), advancedTracks: [] }, new Map())
    expect(plan.advancedTracks).toEqual(DEFAULT_TRACKS)
  })
})

describe('reinsertUnlinked', () => {
  const unlinked = {
    clip: toStoredClip(makeClip('lost')),
    basic: [
      { index: 9, segment: segment('end', 'lost') },
      { index: 1, segment: segment('middle', 'lost') },
    ],
    advanced: [advancedSegment('x', 'lost', 'removed-track')],
  }

  it('puts Basic segments back at their saved positions, clamped to the timeline', () => {
    const placed = reinsertUnlinkedBasic(unlinked, [segment('s1', 'a'), segment('s3', 'a')])
    expect(placed.map((entry) => entry.id)).toEqual(['s1', 'middle', 's3', 'end'])
  })

  it('moves Advanced segments off a removed track onto the top one', () => {
    const placed = reinsertUnlinkedAdvanced(unlinked, [], [{ id: 'top', name: 'Top' }])
    expect(placed[0].trackId).toBe('top')
  })

  it('leaves a timeline that already holds the segments unchanged', () => {
    const once = reinsertUnlinkedBasic(unlinked, [segment('s1', 'a')])
    expect(reinsertUnlinkedBasic(unlinked, once)).toEqual(once)
    const tracks = [{ id: 'top', name: 'Top' }]
    const placed = reinsertUnlinkedAdvanced(unlinked, [], tracks)
    expect(reinsertUnlinkedAdvanced(unlinked, placed, tracks)).toEqual(placed)
  })
})

describe('relinkMismatch', () => {
  const stored = { duration: 10, width: 640, height: 360 }

  it('accepts the same length within tolerance and the same size', () => {
    expect(relinkMismatch(stored, { duration: 10.3, width: 640, height: 360 })).toBeNull()
  })

  it('refuses a different length or frame size', () => {
    expect(relinkMismatch(stored, { duration: 20, width: 640, height: 360 })).toMatch(/length/)
    expect(relinkMismatch(stored, { duration: 10, width: 1280, height: 720 })).toMatch(/size/)
  })
})
