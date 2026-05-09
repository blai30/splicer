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

  return (
    <div class="flex shrink-0 items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 dark:bg-slate-900">
      <button
        class="flex items-center gap-1.5 rounded-md bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        disabled={disabled}
        onClick={setInPoint}
        title="Set in-point (I)"
      >
        <ArrowLeftToLine class="h-3.5 w-3.5" />
        In
      </button>

      <button
        class="flex items-center gap-1.5 rounded-md bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        disabled={disabled}
        onClick={setOutPoint}
        title="Set out-point (O)"
      >
        <ArrowRightToLine class="h-3.5 w-3.5" />
        Out
      </button>

      <button
        class="flex items-center gap-1.5 rounded-md bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        disabled={disabled}
        onClick={cutAtPlayhead}
        title="Split at playhead (C)"
      >
        <Scissors class="h-3.5 w-3.5" />
        Cut
      </button>

      <button
        class="flex items-center gap-1.5 rounded-md bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        disabled={disabled}
        onClick={toggleMute}
        title="Toggle mute"
      >
        {seg?.muted ? <VolumeX class="h-3.5 w-3.5" /> : <Volume2 class="h-3.5 w-3.5" />}
        {seg?.muted ? 'Unmute' : 'Mute'}
      </button>

      <div class="flex-1" />

      <button
        class="flex items-center gap-1.5 rounded-md bg-red-100 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-red-900/40 dark:text-red-400 dark:hover:bg-red-900/60"
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
