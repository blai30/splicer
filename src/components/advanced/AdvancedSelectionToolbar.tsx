import clsx from 'clsx/lite'
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Crop,
  Expand,
  Shrink,
} from 'lucide-preact'

import { placementChanges, plannedPlacement, placeInOutput } from '@/lib/advanced/canvasPlacement'
import { bringForward, bringToFront, sendBackward, sendToBack } from '@/lib/advanced/zOrder'
import { advancedSegments, advancedSelectedId } from '@/lib/store'

const BUTTON =
  'flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 hover:duration-0 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100'

export function AdvancedSelectionToolbar({
  cropMode,
  onToggleCrop,
}: {
  cropMode: boolean
  onToggleCrop: () => void
}) {
  const selectedId = advancedSelectedId.value
  const hasSelection =
    selectedId != null && advancedSegments.value.some((segment) => segment.id === selectedId)

  function run(action: (id: string) => void) {
    if (selectedId) action(selectedId)
  }

  // Disabled when the clip already sits that way (a lone clip in Auto is its
  // own frame, so there is nothing to fit to).
  const selectedSegment = advancedSegments.value.find((segment) => segment.id === selectedId)
  function placementAvailable(mode: 'fit' | 'fill'): boolean {
    if (!selectedSegment) return false
    const placement = plannedPlacement(selectedSegment.id, mode)
    return placement !== null && placementChanges(selectedSegment, placement)
  }

  return (
    <div class="flex flex-wrap items-center gap-1 px-1">
      <button
        class={BUTTON}
        disabled={!hasSelection}
        onClick={() => run(bringToFront)}
        title="Bring to front"
      >
        <ArrowUpToLine class="h-4 w-4" />
        Front
      </button>
      <button
        class={BUTTON}
        disabled={!hasSelection}
        onClick={() => run(bringForward)}
        title="Bring forward"
      >
        <ArrowUp class="h-4 w-4" />
        Forward
      </button>
      <button
        class={BUTTON}
        disabled={!hasSelection}
        onClick={() => run(sendBackward)}
        title="Send backward"
      >
        <ArrowDown class="h-4 w-4" />
        Backward
      </button>
      <button
        class={BUTTON}
        disabled={!hasSelection}
        onClick={() => run(sendToBack)}
        title="Send to back"
      >
        <ArrowDownToLine class="h-4 w-4" />
        Back
      </button>
      <button
        class={clsx(BUTTON, cropMode && 'bg-violet-500/10 text-violet-600 dark:text-violet-300')}
        disabled={!hasSelection}
        onClick={onToggleCrop}
        title="Toggle crop mode"
      >
        <Crop class="h-4 w-4" />
        {cropMode ? 'Done' : 'Crop'}
      </button>
      <span class="mx-0.5 h-4 w-px bg-slate-300 dark:bg-slate-700" aria-hidden="true" />
      <button
        class={BUTTON}
        disabled={!placementAvailable('fit')}
        onClick={() => run((id) => placeInOutput(id, 'fit'))}
        title="Scale the clip to fit inside the output frame, keeping its shape"
      >
        <Shrink class="h-4 w-4" />
        Fit to output
      </button>
      <button
        class={BUTTON}
        disabled={!placementAvailable('fill')}
        onClick={() => run((id) => placeInOutput(id, 'fill'))}
        title="Cover the whole output frame, cropping the clip's edges instead of stretching it"
      >
        <Expand class="h-4 w-4" />
        Fill output
      </button>
    </div>
  )
}
