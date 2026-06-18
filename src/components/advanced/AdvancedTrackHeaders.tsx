import clsx from 'clsx/lite'
import { ChevronDown, ChevronUp, Eye, EyeOff, Plus, Volume2, VolumeX, X } from 'lucide-preact'

import {
  addTrack,
  moveTrack,
  removeTrack,
  setTrackHidden,
  setTrackMuted,
} from '@/lib/advanced/advancedTrackEditing'
import { advancedTracks } from '@/lib/store'

const ICON_BUTTON =
  'flex h-6 w-6 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800 hover:duration-0 dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-100'

export function AdvancedTrackHeaders({ laneHeight }: { laneHeight: number }) {
  const tracks = advancedTracks.value
  return (
    <div class="flex w-40 shrink-0 flex-col gap-1 border-r border-slate-200/60 pr-1 dark:border-slate-700/60">
      <button
        onClick={() => addTrack()}
        class="mb-1 flex items-center gap-1 rounded px-2 py-1 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:duration-0 dark:text-slate-300 dark:hover:bg-slate-700/50"
      >
        <Plus class="h-4 w-4" />
        Add track
      </button>
      {tracks.map((track, index) => (
        <div
          key={track.id}
          class="flex items-center gap-1 rounded bg-slate-100/60 px-2 dark:bg-slate-800/40"
          style={{ height: `${laneHeight}px` }}
        >
          <span class="mr-auto truncate text-sm text-slate-700 dark:text-slate-200">
            {track.name}
          </span>
          <button
            class={ICON_BUTTON}
            title="Move up"
            onClick={() => moveTrack(track.id, -1)}
            disabled={index === 0}
          >
            <ChevronUp class="h-4 w-4" />
          </button>
          <button
            class={ICON_BUTTON}
            title="Move down"
            onClick={() => moveTrack(track.id, 1)}
            disabled={index === tracks.length - 1}
          >
            <ChevronDown class="h-4 w-4" />
          </button>
          <button
            class={clsx(ICON_BUTTON, track.muted && 'text-amber-500')}
            title={track.muted ? 'Unmute track' : 'Mute track'}
            onClick={() => setTrackMuted(track.id, !track.muted)}
          >
            {track.muted ? <VolumeX class="h-4 w-4" /> : <Volume2 class="h-4 w-4" />}
          </button>
          <button
            class={clsx(ICON_BUTTON, track.hidden && 'text-amber-500')}
            title={track.hidden ? 'Show track' : 'Hide track'}
            onClick={() => setTrackHidden(track.id, !track.hidden)}
          >
            {track.hidden ? <EyeOff class="h-4 w-4" /> : <Eye class="h-4 w-4" />}
          </button>
          <button class={ICON_BUTTON} title="Remove track" onClick={() => removeTrack(track.id)}>
            <X class="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
