import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Scissors,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-preact'

import { cutAtPlayhead, deleteSegment, setInPoint, setOutPoint, toggleMute } from '@/lib/actions'
import { selectedSegmentId, timeline } from '@/lib/store'

export function EditToolbar() {
  const seg = timeline.value.find((s) => s.id === selectedSegmentId.value)
  const disabled = !seg
  const toolBtn =
    'flex items-center gap-1.5 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'

  return (
    <div class="flex shrink-0 items-center gap-2 rounded-xl border border-slate-200/80 bg-white/95 px-4 py-2 shadow-lg shadow-slate-900/10 backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/95 dark:shadow-black/30">
      <button class={toolBtn} disabled={disabled} onClick={setInPoint} title="Set in-point (I)">
        <ArrowLeftToLine class="h-3.5 w-3.5" />
        In
      </button>

      <button class={toolBtn} disabled={disabled} onClick={setOutPoint} title="Set out-point (O)">
        <ArrowRightToLine class="h-3.5 w-3.5" />
        Out
      </button>

      <button
        class={toolBtn}
        disabled={disabled}
        onClick={cutAtPlayhead}
        title="Split at playhead (C)"
      >
        <Scissors class="h-3.5 w-3.5" />
        Cut
      </button>

      <button class={toolBtn} disabled={disabled} onClick={toggleMute} title="Toggle mute">
        {seg?.muted ? <VolumeX class="h-3.5 w-3.5" /> : <Volume2 class="h-3.5 w-3.5" />}
        {seg?.muted ? 'Unmute' : 'Mute'}
      </button>

      <div class="flex-1" />

      <button
        class="flex items-center gap-1.5 rounded-md bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-red-900/40 dark:text-red-400 dark:hover:bg-red-900/60"
        disabled={disabled}
        onClick={deleteSegment}
        title="Delete segment"
      >
        <Trash2 class="h-3.5 w-3.5" />
        Delete
      </button>
    </div>
  )
}
