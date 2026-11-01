import { useSignal } from '@preact/signals'
import { AlertTriangle, History, Link2, LoaderCircle, Trash2, X } from 'lucide-preact'

import { formatSize, formatTime } from '@/lib/format'
import {
  discardSavedProject,
  mediaNotKept,
  mediaNotKeptMessage,
  persistenceError,
  persistenceStatus,
  relinkClip,
  removeUnlinkedClip,
  restoreOffer,
  restoreSavedProject,
  restoring,
  unlinkedClips,
} from '@/lib/project/projectPersistence'
import type { UnlinkedClip } from '@/lib/project/projectSnapshot'
import { advancedSegments, timeline } from '@/lib/store'
import { createClip, FILE_INPUT_ACCEPT } from '@/lib/videoImport'

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function RestoreOffer() {
  const offer = restoreOffer.value
  if (!offer) return null
  const savedAt = new Date(offer.savedAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const replacesWork = timeline.value.length > 0 || advancedSegments.value.length > 0
  return (
    <section
      aria-label="Saved project"
      class="flex flex-wrap items-center gap-3 rounded-lg border border-violet-200/70 bg-violet-50/70 px-4 py-2 text-sm text-slate-700 backdrop-blur-sm dark:border-violet-800/50 dark:bg-violet-950/40 dark:text-slate-200"
    >
      <History class="size-4 shrink-0 text-violet-500" aria-hidden="true" />
      <p class="min-w-0 flex-1">
        Restore your previous project? {plural(offer.clipCount, 'clip')},{' '}
        {plural(offer.segmentCount, 'segment')}, saved {savedAt}.
        {replacesWork && ' It replaces what you have open now.'}
      </p>
      <div class="flex gap-2">
        <button
          type="button"
          onClick={() => void restoreSavedProject()}
          disabled={restoring.value}
          class="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1 font-medium text-white hover:bg-violet-500 focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60 dark:focus-visible:ring-offset-slate-900"
        >
          {restoring.value && (
            <LoaderCircle
              class="size-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          Restore
        </button>
        <button
          type="button"
          onClick={() => void discardSavedProject()}
          disabled={restoring.value}
          class="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:outline-none disabled:opacity-60 dark:border-slate-600 dark:hover:bg-slate-800"
        >
          Discard
        </button>
      </div>
    </section>
  )
}

function UnlinkedRow({ entry }: { entry: UnlinkedClip }) {
  const busy = useSignal(false)
  const problem = useSignal<string | null>(null)
  const { clip } = entry
  const segmentCount = entry.basic.length + entry.advanced.length

  async function onPick(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    busy.value = true
    problem.value = null
    try {
      problem.value = await relinkClip(clip.id, file, createClip)
    } finally {
      busy.value = false
    }
  }

  return (
    <li class="flex flex-col gap-1 py-1.5">
      <div class="flex flex-wrap items-center gap-2">
        <span class="min-w-0 flex-1 truncate">
          <span class="font-medium">{clip.fileName}</span>{' '}
          <span class="text-slate-500 dark:text-slate-400">
            {formatTime(clip.duration)} · {formatSize(clip.fileSize)} ·{' '}
            {plural(segmentCount, 'segment')}
          </span>
        </span>
        <label class="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-violet-600 px-2.5 py-1 font-medium text-white focus-within:ring-2 focus-within:ring-violet-400 hover:bg-violet-500">
          {busy.value ? (
            <LoaderCircle
              class="size-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <Link2 class="size-3.5" aria-hidden="true" />
          )}
          Relink
          <input
            type="file"
            accept={FILE_INPUT_ACCEPT}
            class="sr-only"
            disabled={busy.value}
            onChange={(event) => void onPick(event)}
            aria-label={`Relink ${clip.fileName}`}
          />
        </label>
        <button
          type="button"
          onClick={() => removeUnlinkedClip(clip.id)}
          class="rounded-md p-1 text-slate-500 hover:bg-amber-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:outline-none dark:hover:bg-amber-900/40 dark:hover:text-slate-200"
          aria-label={`Remove ${clip.fileName} and its segments`}
          title="Remove its segments"
        >
          <Trash2 class="size-4" aria-hidden="true" />
        </button>
      </div>
      {problem.value && (
        <p role="alert" class="text-red-700 dark:text-red-300">
          {problem.value}
        </p>
      )}
    </li>
  )
}

function RelinkList() {
  const entries = unlinkedClips.value
  if (entries.length === 0) return null
  return (
    <section
      aria-label="Clips to relink"
      class="flex flex-col gap-1 rounded-lg border border-amber-300/70 bg-amber-50/70 px-4 py-2 text-sm text-slate-700 backdrop-blur-sm dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-slate-200"
    >
      <p class="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
        <AlertTriangle class="size-4 shrink-0" aria-hidden="true" />
        {entries.length === 1
          ? 'One clip could not be restored. Choose its original file to put its segments back.'
          : `${entries.length} clips could not be restored. Choose each original file to put their segments back.`}
      </p>
      <ul class="divide-y divide-amber-200/70 dark:divide-amber-900/50">
        {entries.map((entry) => (
          <UnlinkedRow key={entry.clip.id} entry={entry} />
        ))}
      </ul>
    </section>
  )
}

function StorageNotice() {
  const dismissedKey = useSignal<string | null>(null)
  const notKept = mediaNotKept.value
  const failure =
    persistenceError.value ??
    (persistenceStatus.value === 'elsewhere'
      ? 'Splicer is open in another tab, which keeps the saved project. Changes here are not saved; close the other tab and reload this one to save here.'
      : null)
  const key = failure ?? notKept.map((entry) => entry.name).join('\n')
  if ((!failure && notKept.length === 0) || dismissedKey.value === key) return null
  return (
    <div
      role="status"
      class="flex items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-50/70 px-4 py-2 text-sm text-amber-900 backdrop-blur-sm dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <AlertTriangle class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p class="flex-1">{failure ?? mediaNotKeptMessage(notKept)}</p>
      <button
        type="button"
        onClick={() => (dismissedKey.value = key)}
        class="shrink-0 rounded p-0.5 hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:outline-none dark:hover:bg-amber-900/50"
        aria-label="Dismiss storage notice"
      >
        <X class="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}

// The saved-project offer, clips waiting to be relinked, and storage notices.
// None of it blocks the editor.
export function ProjectRestoreBanner() {
  return (
    <div class="flex flex-col gap-2 empty:hidden">
      <RestoreOffer />
      <RelinkList />
      <StorageNotice />
    </div>
  )
}
