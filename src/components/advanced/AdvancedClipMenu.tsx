import {
  ArrowLeftToLine,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Scissors,
  Trash2,
  Volume2,
  VolumeX,
  FoldHorizontal,
} from 'lucide-preact'

import { ContextMenu, type ContextMenuItem } from '@/components/ContextMenu'
import { segmentDuration } from '@/lib/advanced/advancedTimelineDomain'
import {
  advancedClipboardSize,
  closeGapsOnSelectedTrack,
  copyAdvancedSelected,
  cutAdvancedAtPlayhead,
  deleteAdvancedSelected,
  duplicateAdvancedSelected,
  pasteAdvanced,
  rippleDeleteAdvancedSelected,
  toggleAdvancedMute,
} from '@/lib/advanced/advancedTimelineEditing'
import { trackHasGaps } from '@/lib/advanced/clipEditingDomain'
import {
  advancedClipMenu,
  advancedPlayhead,
  advancedSegments,
  advancedSelectedIds,
} from '@/lib/store'

// Right-click (or the Menu key) menu for the selected Advanced clips.
export function AdvancedClipMenu() {
  const menu = advancedClipMenu.value
  if (!menu) return null
  const segments = advancedSegments.value
  const clip = segments.find((segment) => segment.id === menu.segmentId)
  if (!clip) return null
  const selectedIds = new Set(advancedSelectedIds.value)
  const selected = segments.filter((segment) => selectedIds.has(segment.id))
  const count = selected.length
  const plural = count > 1 ? ` ${count} clips` : ''
  const allMuted = selected.length > 0 && selected.every((segment) => segment.muted)
  const playheadInside =
    advancedPlayhead.value > clip.timelineStart &&
    advancedPlayhead.value < clip.timelineStart + segmentDuration(clip)

  const items: ContextMenuItem[] = [
    {
      label: `Duplicate${plural}`,
      icon: CopyPlus,
      shortcut: { display: 'Ctrl D', aria: 'Control+D' },
      run: duplicateAdvancedSelected,
    },
    {
      label: `Copy${plural}`,
      icon: Copy,
      shortcut: { display: 'Ctrl C', aria: 'Control+C' },
      run: () => void copyAdvancedSelected(),
    },
    {
      label: 'Paste at playhead',
      icon: ClipboardPaste,
      shortcut: { display: 'Ctrl V', aria: 'Control+V' },
      disabled: advancedClipboardSize.value === 0,
      run: pasteAdvanced,
    },
    {
      label: 'Split at playhead',
      icon: Scissors,
      shortcut: { display: 'C', aria: 'C' },
      disabled: !playheadInside,
      run: cutAdvancedAtPlayhead,
    },
    {
      label: allMuted ? `Unmute${plural}` : `Mute${plural}`,
      icon: allMuted ? Volume2 : VolumeX,
      shortcut: { display: 'M', aria: 'M' },
      run: toggleAdvancedMute,
    },
    {
      label: 'Close gaps on track',
      icon: FoldHorizontal,
      disabled: !trackHasGaps(segments, clip.trackId),
      run: closeGapsOnSelectedTrack,
    },
    {
      label: `Ripple delete${plural}`,
      icon: ArrowLeftToLine,
      shortcut: { display: 'Shift Del', aria: 'Shift+Delete' },
      danger: true,
      run: rippleDeleteAdvancedSelected,
    },
    {
      label: `Delete${plural}`,
      icon: Trash2,
      shortcut: { display: 'Del', aria: 'Delete' },
      danger: true,
      run: deleteAdvancedSelected,
    },
  ]

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      label={count > 1 ? `Actions for ${count} clips` : 'Clip actions'}
      items={items}
      onClose={() => (advancedClipMenu.value = null)}
    />
  )
}
