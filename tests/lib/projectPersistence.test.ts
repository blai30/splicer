import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MediaWrite, ProjectStorage } from '@/lib/project/projectDatabase'
import {
  discardSavedProject,
  flushProjectSave,
  initProjectPersistence,
  mediaNotKept,
  persistenceError,
  persistenceStatus,
  PROJECT_MEDIA_BYTE_LIMIT,
  projectSaved,
  relinkClip,
  removeUnlinkedClip,
  resetProjectPersistence,
  restoreOffer,
  restoreSavedProject,
  unlinkedClips,
} from '@/lib/project/projectPersistence'
import { buildProjectRecord, DEFAULT_TRACKS } from '@/lib/project/projectSnapshot'
import { advancedSegments, advancedTracks, clips, selectedSegmentId, timeline } from '@/lib/store'
import type { AdvancedSegment, Clip } from '@/lib/types'
import { hasUnsavedWork } from '@/lib/unloadGuard'

function makeClip(id: string, bytes = 8): Clip {
  return {
    id,
    file: new File([new Uint8Array(bytes)], `${id}.mp4`, { type: 'video/mp4' }),
    name: id,
    duration: 10,
    width: 640,
    height: 360,
    objectUrl: `blob:${id}`,
    waveformPeaks: new Float32Array(0),
  }
}

const advancedSegment = (id: string, clipId: string): AdvancedSegment => ({
  id,
  clipId,
  trackId: 'track-1',
  timelineStart: 0,
  sourceStart: 0,
  sourceEnd: 4,
  transform: { x: 0, y: 0, width: 640, height: 360 },
})

// An in-memory stand-in for IndexedDB with the same all-or-nothing saves.
function memoryStorage(initial: { project?: unknown; media?: Map<string, File> } = {}) {
  let project = initial.project
  const media = new Map(initial.media ?? [])
  const saves: { record: unknown; media: readonly MediaWrite[]; deleted: readonly string[] }[] = []
  const storage: ProjectStorage & { failNextSave?: Error } = {
    loadProject: async () => project,
    loadMediaIds: async () => [...media.keys()],
    loadMedia: async (ids) =>
      new Map(ids.flatMap((id) => (media.has(id) ? [[id, media.get(id)!] as const] : []))),
    saveProject: async (record, writes, deleted) => {
      if (storage.failNextSave) {
        const failure = storage.failNextSave
        storage.failNextSave = undefined
        throw failure
      }
      for (const id of deleted) media.delete(id)
      for (const entry of writes) media.set(entry.id, entry.file)
      project = record
      saves.push({ record, media: writes, deleted })
    },
    clear: async () => {
      project = undefined
      media.clear()
    },
  }
  return { storage, saves, media, project: () => project }
}

function resetEditors() {
  clips.value = []
  timeline.value = []
  selectedSegmentId.value = null
  advancedSegments.value = []
  advancedTracks.value = DEFAULT_TRACKS
}

beforeEach(() => {
  vi.useFakeTimers()
  resetProjectPersistence()
  resetEditors()
})

afterEach(() => {
  resetProjectPersistence()
  resetEditors()
  vi.useRealTimers()
})

async function settle() {
  await vi.runAllTimersAsync()
  await flushProjectSave()
}

describe('autosave', () => {
  it('starts saving right away when nothing was stored', async () => {
    const { storage, saves, media } = memoryStorage()
    await initProjectPersistence(storage)
    expect(persistenceStatus.value).toBe('active')
    expect(restoreOffer.value).toBeNull()

    const clip = makeClip('a')
    clips.value = [clip]
    timeline.value = [{ id: 's1', clipId: 'a', startTime: 0, endTime: 5 }]
    expect(projectSaved.value).toBe(false)
    expect(hasUnsavedWork()).toBe(true)

    await settle()
    expect(saves).toHaveLength(1)
    expect(media.get('a')).toBe(clip.file)
    expect(projectSaved.value).toBe(true)
    expect(hasUnsavedWork()).toBe(false)
  })

  it('stores each file once and deletes files the project stops using', async () => {
    const { storage, saves, media } = memoryStorage()
    await initProjectPersistence(storage)
    clips.value = [makeClip('a'), makeClip('b')]
    timeline.value = [
      { id: 's1', clipId: 'a', startTime: 0, endTime: 5 },
      { id: 's2', clipId: 'b', startTime: 0, endTime: 5 },
    ]
    await settle()
    timeline.value = [{ id: 's1', clipId: 'a', startTime: 1, endTime: 5 }]
    await settle()
    expect(saves[1].media).toEqual([])
    expect(saves[1].deleted).toEqual(['b'])
    expect([...media.keys()]).toEqual(['a'])
  })

  it('clears storage once the project is empty', async () => {
    const { storage, project } = memoryStorage()
    await initProjectPersistence(storage)
    clips.value = [makeClip('a')]
    timeline.value = [{ id: 's1', clipId: 'a', startTime: 0, endTime: 5 }]
    await settle()
    timeline.value = []
    await settle()
    expect(project()).toBeUndefined()
  })

  it('flags files over the size budget and keeps warning before unload', async () => {
    const { storage, media } = memoryStorage()
    await initProjectPersistence(storage)
    const huge = makeClip('huge')
    Object.defineProperty(huge.file, 'size', { value: PROJECT_MEDIA_BYTE_LIMIT + 1 })
    clips.value = [huge]
    timeline.value = [{ id: 's1', clipId: 'huge', startTime: 0, endTime: 5 }]
    await settle()
    expect(media.size).toBe(0)
    expect(mediaNotKept.value).toEqual([{ name: 'huge', size: PROJECT_MEDIA_BYTE_LIMIT + 1 }])
    expect(projectSaved.value).toBe(false)
    expect(hasUnsavedWork()).toBe(true)
  })

  it('saves without new files when storage is full', async () => {
    const { storage, media, project } = memoryStorage()
    await initProjectPersistence(storage)
    storage.failNextSave = new DOMException('full', 'QuotaExceededError')
    clips.value = [makeClip('a')]
    timeline.value = [{ id: 's1', clipId: 'a', startTime: 0, endTime: 5 }]
    await settle()
    expect(media.size).toBe(0)
    expect(project()).toBeDefined()
    expect(mediaNotKept.value.map((entry) => entry.name)).toEqual(['a'])
  })

  it('reports a failed save without throwing', async () => {
    const { storage } = memoryStorage()
    await initProjectPersistence(storage)
    storage.failNextSave = new Error('disk gone')
    clips.value = [makeClip('a')]
    timeline.value = [{ id: 's1', clipId: 'a', startTime: 0, endTime: 5 }]
    await settle()
    expect(persistenceError.value).toMatch(/disk gone/)
    expect(hasUnsavedWork()).toBe(true)
  })

  it('treats unavailable storage as never saved', async () => {
    await initProjectPersistence(null)
    expect(persistenceStatus.value).toBe('unavailable')
    timeline.value = [{ id: 's1', clipId: 'a', startTime: 0, endTime: 5 }]
    expect(hasUnsavedWork()).toBe(true)
  })

  it('treats storage that fails to open as unavailable', async () => {
    const { storage } = memoryStorage()
    storage.loadProject = () => Promise.reject(new Error('blocked'))
    await initProjectPersistence(storage)
    expect(persistenceStatus.value).toBe('unavailable')
  })
})

describe('restore', () => {
  function savedProject() {
    const kept = makeClip('kept')
    const lost = makeClip('lost')
    const record = buildProjectRecord(
      {
        clips: [kept, lost],
        timeline: [
          { id: 's1', clipId: 'kept', startTime: 0, endTime: 5 },
          { id: 's2', clipId: 'lost', startTime: 0, endTime: 5 },
        ],
        selectedSegmentId: 's1',
        advancedTracks: DEFAULT_TRACKS,
        advancedSegments: [advancedSegment('x', 'lost')],
        unlinked: [],
      },
      1000
    )
    return { kept, lost, record }
  }

  it('offers the saved project and does not overwrite it until the user chooses', async () => {
    const { record, kept } = savedProject()
    const { storage, saves } = memoryStorage({
      project: record,
      media: new Map([['kept', kept.file]]),
    })
    await initProjectPersistence(storage)
    expect(persistenceStatus.value).toBe('offering')
    expect(restoreOffer.value).toEqual({ savedAt: 1000, clipCount: 2, segmentCount: 3 })

    clips.value = [makeClip('new')]
    timeline.value = [{ id: 'n', clipId: 'new', startTime: 0, endTime: 1 }]
    await settle()
    expect(saves).toHaveLength(0)
    expect(hasUnsavedWork()).toBe(true)
  })

  it('restores the clips it has and lists the rest for relinking', async () => {
    const { record, kept } = savedProject()
    const { storage } = memoryStorage({ project: record, media: new Map([['kept', kept.file]]) })
    await initProjectPersistence(storage)
    await restoreSavedProject()

    expect(restoreOffer.value).toBeNull()
    expect(persistenceStatus.value).toBe('active')
    expect(timeline.value.map((segment) => segment.id)).toEqual(['s1'])
    expect(selectedSegmentId.value).toBe('s1')
    expect(clips.value.map((clip) => clip.id)).toEqual(['kept'])
    expect(clips.value[0].file).toBe(kept.file)
    expect(clips.value[0].objectUrl).toMatch(/^blob:/)
    expect(unlinkedClips.value.map((entry) => entry.clip.id)).toEqual(['lost'])
  })

  it('relinks a matching file and puts its segments back', async () => {
    const { record, kept } = savedProject()
    const { storage } = memoryStorage({ project: record, media: new Map([['kept', kept.file]]) })
    await initProjectPersistence(storage)
    await restoreSavedProject()

    const picked = new File([new Uint8Array(8)], 'renamed.mp4')
    const probe = async (file: File): Promise<Clip> => ({
      ...makeClip('probed'),
      file,
      objectUrl: 'blob:probed',
    })
    expect(await relinkClip('lost', picked, probe)).toBeNull()
    expect(unlinkedClips.value).toEqual([])
    expect(timeline.value.map((segment) => segment.id)).toEqual(['s1', 's2'])
    expect(advancedSegments.value.map((segment) => segment.id)).toEqual(['x'])
    const relinked = clips.value.find((clip) => clip.id === 'lost')
    expect(relinked?.file).toBe(picked)
    expect(relinked?.name).toBe('lost')
  })

  it('refuses a file that does not match and keeps the clip listed', async () => {
    const { record, kept } = savedProject()
    const { storage } = memoryStorage({ project: record, media: new Map([['kept', kept.file]]) })
    await initProjectPersistence(storage)
    await restoreSavedProject()

    const probe = async (file: File): Promise<Clip> => ({
      ...makeClip('other'),
      file,
      duration: 60,
    })
    const reason = await relinkClip('lost', new File([], 'other.mp4'), probe)
    expect(reason).toMatch(/does not match "lost"/)
    expect(unlinkedClips.value).toHaveLength(1)
    expect(await relinkClip('lost', new File([], 'bad.mp4'), async () => null)).toMatch(
      /could not be read/
    )
  })

  it('saves clips awaiting relink so a reload offers them again', async () => {
    const { record, kept } = savedProject()
    const memory = memoryStorage({ project: record, media: new Map([['kept', kept.file]]) })
    await initProjectPersistence(memory.storage)
    await restoreSavedProject()
    await settle()

    resetProjectPersistence()
    resetEditors()
    await initProjectPersistence(memory.storage)
    expect(restoreOffer.value?.segmentCount).toBe(3)
    await restoreSavedProject()
    expect(unlinkedClips.value.map((entry) => entry.clip.id)).toEqual(['lost'])
    removeUnlinkedClip('lost')
    expect(unlinkedClips.value).toEqual([])
  })

  it('keeps the edits when no stored file can be read', async () => {
    const { record } = savedProject()
    const { storage } = memoryStorage({ project: record })
    storage.loadMedia = () => Promise.reject(new Error('evicted'))
    await initProjectPersistence(storage)
    await restoreSavedProject()
    expect(timeline.value).toEqual([])
    expect(unlinkedClips.value.map((entry) => entry.clip.id)).toEqual(['kept', 'lost'])
  })

  it('discards the saved project and starts saving the current one', async () => {
    const { record, kept } = savedProject()
    const memory = memoryStorage({ project: record, media: new Map([['kept', kept.file]]) })
    await initProjectPersistence(memory.storage)
    await discardSavedProject()
    expect(restoreOffer.value).toBeNull()
    expect(memory.project()).toBeUndefined()
    expect(memory.media.size).toBe(0)
    expect(persistenceStatus.value).toBe('active')
  })

  it('ignores a record from an unknown schema version', async () => {
    const { storage } = memoryStorage({ project: { version: 99, timeline: [] } })
    await initProjectPersistence(storage)
    expect(restoreOffer.value).toBeNull()
    expect(persistenceStatus.value).toBe('active')
  })
})
