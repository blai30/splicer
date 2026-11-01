import { useSignal } from '@preact/signals'
import clsx from 'clsx/lite'
import { ChevronDown, ChevronUp, Eye, EyeOff, Plus, Volume2, VolumeX, X } from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'

import { activeAdvancedTrackId, setActiveAdvancedTrack } from '@/lib/advanced/advancedSelection'
import {
  addTrack,
  moveTrack,
  removeTrack,
  renameTrack,
  setTrackHidden,
  setTrackMuted,
} from '@/lib/advanced/advancedTrackEditing'
import { advancedTracks } from '@/lib/store'
import type { Track } from '@/lib/types'

const ICON_BUTTON =
  'flex h-6 w-6 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-100'

export function AdvancedTrackHeaders({ laneHeight }: { laneHeight: number }) {
  const tracks = advancedTracks.value
  // Reads the active-track signal, so the highlight follows it.
  const activeId = activeAdvancedTrackId()
  return (
    <div class="flex w-54 shrink-0 flex-col border-r border-slate-200/60 pr-1 dark:border-slate-700/60">
      {/* Fixed h-7 row mirrors the lanes' spacer so each header lines up with its lane. */}
      <button
        onClick={() => addTrack()}
        class="flex h-7 shrink-0 items-center gap-1 rounded px-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:duration-0 dark:text-slate-300 dark:hover:bg-slate-700/50"
      >
        <Plus class="h-4 w-4" />
        Add track
      </button>
      {tracks.map((track, index) => (
        <div
          key={track.id}
          data-advanced-track-header
          class={clsx(
            'flex items-center gap-1 border-b border-l-2 border-b-slate-200/40 pr-2 pl-1.5 dark:border-b-slate-700/40',
            track.id === activeId ? 'border-l-violet-500 bg-violet-500/5' : 'border-l-transparent'
          )}
          style={{ height: `${laneHeight}px` }}
        >
          <TrackName track={track} active={track.id === activeId} />
          <button
            class={ICON_BUTTON}
            title="Move up"
            aria-label={`Move ${track.name} up`}
            onClick={() => moveTrack(track.id, -1)}
            disabled={index === 0}
          >
            <ChevronUp class="h-4 w-4" />
          </button>
          <button
            class={ICON_BUTTON}
            title="Move down"
            aria-label={`Move ${track.name} down`}
            onClick={() => moveTrack(track.id, 1)}
            disabled={index === tracks.length - 1}
          >
            <ChevronDown class="h-4 w-4" />
          </button>
          <button
            class={clsx(ICON_BUTTON, track.muted && 'text-amber-500')}
            title={track.muted ? 'Unmute track' : 'Mute track'}
            aria-pressed={track.muted === true}
            aria-label={`Mute ${track.name}`}
            onClick={() => setTrackMuted(track.id, !track.muted)}
          >
            {track.muted ? <VolumeX class="h-4 w-4" /> : <Volume2 class="h-4 w-4" />}
          </button>
          <button
            class={clsx(ICON_BUTTON, track.hidden && 'text-amber-500')}
            title={track.hidden ? 'Show track' : 'Hide track'}
            aria-pressed={track.hidden === true}
            aria-label={`Hide ${track.name}`}
            onClick={() => setTrackHidden(track.id, !track.hidden)}
          >
            {track.hidden ? <EyeOff class="h-4 w-4" /> : <Eye class="h-4 w-4" />}
          </button>
          <button
            class={ICON_BUTTON}
            title={tracks.length <= 1 ? 'A project needs at least one track' : 'Remove track'}
            aria-label={`Remove ${track.name}`}
            onClick={() => removeTrack(track.id)}
            disabled={tracks.length <= 1}
          >
            <X class="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}

// The track's name: a click makes it the active track (where paste, imports,
// and drops land); a double-click or F2 renames it in place. Enter or leaving
// the field saves, Escape cancels, and an empty name keeps the old one.
function TrackName({ track, active }: { track: Track; active: boolean }) {
  const editing = useSignal(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!editing.value) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing.value])

  function finish(save: boolean) {
    if (!editing.value) return
    const name = inputRef.current?.value.trim() ?? ''
    editing.value = false
    if (save && name) renameTrack(track.id, name)
    // Keep keyboard users where they were.
    requestAnimationFrame(() => buttonRef.current?.focus())
  }

  if (editing.value) {
    return (
      <input
        ref={inputRef}
        type="text"
        defaultValue={track.name}
        aria-label={`Rename ${track.name}`}
        maxLength={40}
        class="mr-auto w-full min-w-0 rounded border border-violet-400 bg-white px-1 text-sm text-slate-900 outline-none dark:bg-slate-800 dark:text-slate-100"
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            finish(true)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            finish(false)
          }
        }}
      />
    )
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-pressed={active}
      aria-label={`${track.name}, ${active ? 'active track' : 'make active track'}`}
      aria-keyshortcuts="F2"
      title="Click to paste and import here, double-click or F2 to rename"
      class={clsx(
        'mr-auto min-w-0 truncate rounded px-1 text-left text-sm transition-colors hover:bg-slate-100 hover:duration-0 dark:hover:bg-slate-700/50',
        active
          ? 'font-semibold text-violet-700 dark:text-violet-300'
          : 'text-slate-700 dark:text-slate-200'
      )}
      onClick={() => setActiveAdvancedTrack(track.id)}
      onDblClick={() => (editing.value = true)}
      onKeyDown={(event) => {
        if (event.key !== 'F2') return
        event.preventDefault()
        editing.value = true
      }}
    >
      {track.name}
    </button>
  )
}
