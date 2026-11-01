import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { recordAdvancedHistory, redoAdvanced, undoAdvanced } from '@/lib/advanced/advancedHistory'
import { collectUnusedClips } from '@/lib/clipPool'
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
  type ProjectLock,
  removeUnlinkedClip,
  resetProjectPersistence,
  restoreOffer,
  restoreSavedProject,
  unlinkedClips,
  webProjectLock,
} from '@/lib/project/projectPersistence'
import { buildProjectRecord, DEFAULT_TRACKS } from '@/lib/project/projectSnapshot'
import { advancedSegments, advancedTracks, clips, selectedSegmentId, timeline } from '@/lib/store'
import { redo, toggleMute, undo } from '@/lib/timelineEditing'
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

  it('does not retry a file refused for lack of space on later saves', async () => {
    const { storage, media, saves } = memoryStorage()
    const attempts: string[][] = []
    const save = storage.saveProject
    storage.saveProject = async (record, writes, deleted) => {
      attempts.push(writes.map((write) => write.id))
      if (writes.some((write) => write.id === 'big')) {
        throw new DOMException('full', 'QuotaExceededError')
      }
      await save(record, writes, deleted)
    }
    await initProjectPersistence(storage)
    clips.value = [makeClip('a'), makeClip('big', 64)]
    timeline.value = [
      { id: 's1', clipId: 'a', startTime: 0, endTime: 5 },
      { id: 's2', clipId: 'big', startTime: 0, endTime: 5 },
    ]
    await settle()
    expect(attempts).toEqual([['a', 'big'], []])
    expect(mediaNotKept.value.map((entry) => entry.name)).toEqual(['a', 'big'])

    timeline.value = [...timeline.value, { id: 's3', clipId: 'a', startTime: 1, endTime: 2 }]
    await settle()
    // One write, without the refused file, and it succeeds.
    expect(attempts.slice(2)).toEqual([['a']])
    expect([...media.keys()]).toEqual(['a'])
    expect(mediaNotKept.value.map((entry) => entry.name)).toEqual(['big'])
    expect(saves).toHaveLength(2)
  })

  it('tries a refused file again once stored files are deleted', async () => {
    const { storage } = memoryStorage()
    const attempts: string[][] = []
    const save = storage.saveProject
    let full = true
    storage.saveProject = async (record, writes, deleted) => {
      attempts.push(writes.map((write) => write.id))
      if (full && writes.some((write) => write.id === 'big')) {
        throw new DOMException('full', 'QuotaExceededError')
      }
      await save(record, writes, deleted)
    }
    await initProjectPersistence(storage)
    clips.value = [makeClip('a'), makeClip('big', 64)]
    timeline.value = [{ id: 's1', clipId: 'a', startTime: 0, endTime: 5 }]
    await settle()
    timeline.value = [
      { id: 's1', clipId: 'a', startTime: 0, endTime: 5 },
      { id: 's2', clipId: 'big', startTime: 0, endTime: 5 },
    ]
    await settle()
    expect(attempts).toEqual([['a'], ['big'], []])

    full = false
    clips.value = [clips.value[1]]
    timeline.value = [{ id: 's2', clipId: 'big', startTime: 0, endTime: 5 }]
    await settle()
    // Deleting "a" frees space, so the save after it offers "big" again.
    expect(attempts.slice(3)).toEqual([[]])
    timeline.value = [{ id: 's2', clipId: 'big', startTime: 1, endTime: 5 }]
    await settle()
    expect(attempts.slice(4)).toEqual([['big']])
    expect(mediaNotKept.value).toEqual([])
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

  it('leaves the stored project alone while another tab owns it', async () => {
    const { storage, saves } = memoryStorage()
    const loadProject = vi.spyOn(storage, 'loadProject')
    const heldElsewhere: ProjectLock = async () => ({ owned: false, release: () => {} })
    await initProjectPersistence(storage, heldElsewhere)
    expect(persistenceStatus.value).toBe('elsewhere')
    expect(loadProject).not.toHaveBeenCalled()

    clips.value = [makeClip('a')]
    timeline.value = [{ id: 's1', clipId: 'a', startTime: 0, endTime: 5 }]
    await settle()
    expect(saves).toHaveLength(0)
    expect(hasUnsavedWork()).toBe(true)
  })

  it('releases the tab lock on reset', async () => {
    const { storage } = memoryStorage()
    const release = vi.fn()
    await initProjectPersistence(storage, async () => ({ owned: true, release }))
    expect(persistenceStatus.value).toBe('active')
    resetProjectPersistence()
    expect(release).toHaveBeenCalledOnce()
  })

  it('holds a Web Lock only when it is free', async () => {
    type Callback = (lock: object | null) => unknown
    let free = true
    const request = vi.fn((_name: string, _options: object, callback: Callback) => {
      const result = callback(free ? {} : null)
      return Promise.resolve(result)
    })
    vi.stubGlobal('navigator', { locks: { request } })
    try {
      const first = await webProjectLock()
      expect(first.owned).toBe(true)
      expect(request).toHaveBeenCalledWith(
        'splicer-project',
        { ifAvailable: true },
        expect.any(Function)
      )
      free = false
      expect((await webProjectLock()).owned).toBe(false)
      first.release()
    } finally {
      vi.unstubAllGlobals()
    }
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

  it('keeps relinked segments through undo, redo, and the next edit', async () => {
    const { record, kept } = savedProject()
    const { storage } = memoryStorage({ project: record, media: new Map([['kept', kept.file]]) })
    await initProjectPersistence(storage)
    await restoreSavedProject()
    // An edit in each editor before the relink, so undo has older snapshots.
    toggleMute('s1')
    recordAdvancedHistory()
    advancedTracks.value = [...DEFAULT_TRACKS, { id: 'track-2', name: 'Track 2' }]

    const probe = async (file: File): Promise<Clip> => ({ ...makeClip('probed'), file })
    expect(await relinkClip('lost', new File([], 'lost.mp4'), probe)).toBeNull()

    undo()
    undoAdvanced()
    expect(timeline.value.map((segment) => segment.id)).toEqual(['s1', 's2'])
    expect(timeline.value[0].muted).toBeFalsy()
    expect(advancedSegments.value.map((segment) => segment.id)).toEqual(['x'])
    expect(advancedTracks.value).toEqual(DEFAULT_TRACKS)
    redo()
    redoAdvanced()
    expect(timeline.value.map((segment) => segment.id)).toEqual(['s1', 's2'])
    expect(timeline.value[0].muted).toBe(true)
    expect(advancedSegments.value.map((segment) => segment.id)).toEqual(['x'])

    undo()
    // A new edit drops the redo branch; the relinked clip is still reachable.
    toggleMute('s2')
    collectUnusedClips()
    expect(timeline.value.map((segment) => segment.id)).toEqual(['s1', 's2'])
    expect(clips.value.map((clip) => clip.id)).toContain('lost')
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
