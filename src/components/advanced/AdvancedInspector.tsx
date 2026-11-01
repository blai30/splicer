import { useSignal } from '@preact/signals'
import clsx from 'clsx/lite'
import { Link2, Unlink2 } from 'lucide-preact'
import { useLayoutEffect, useRef } from 'preact/hooks'

import { beginAdvancedGesture } from '@/lib/advanced/advancedHistory'
import { placeSegment, setSegmentProps } from '@/lib/advanced/advancedSegmentEditing'
import { segmentDuration } from '@/lib/advanced/advancedTimelineDomain'
import { MIN_TRANSFORM_SIZE } from '@/lib/advanced/transformMath'
import { advancedSegments, advancedSelectedId, advancedSelectedIds } from '@/lib/store'
import type { Transform } from '@/lib/types'

type BoxField = 'x' | 'y' | 'width' | 'height'
type FadeField = 'fadeIn' | 'fadeOut'
type TypedField = BoxField | FadeField

// Text typed into fields of one clip and not yet committed.
type PendingEntries = { id: string | null; values: Partial<Record<TypedField, string>> }

const BOX_FIELDS: { field: BoxField; label: string; name: string }[] = [
  { field: 'x', label: 'X', name: 'X position' },
  { field: 'y', label: 'Y', name: 'Y position' },
  { field: 'width', label: 'W', name: 'Width' },
  { field: 'height', label: 'H', name: 'Height' },
]

// The box after typing `value` into `field`. With the aspect linked, a new
// width or height scales the other side along the clip's current shape.
export function editedTransform(
  transform: Transform,
  field: BoxField,
  value: number,
  linked: boolean
): Transform {
  if (field === 'x' || field === 'y') return { ...transform, [field]: value }
  const size = Math.max(MIN_TRANSFORM_SIZE, value)
  const aspect = transform.width / transform.height
  if (field === 'width') {
    return { ...transform, width: size, height: linked ? size / aspect : transform.height }
  }
  return { ...transform, height: size, width: linked ? size * aspect : transform.width }
}

// Store `text` typed into `field` of clip `id`; an entry that is not a number
// changes nothing.
function commitTypedValue(id: string, field: TypedField, text: string, linked: boolean) {
  const current = advancedSegments.value.find((entry) => entry.id === id)
  const value = Number(text)
  if (!current || text.trim() === '' || !Number.isFinite(value)) return
  if (field === 'fadeIn' || field === 'fadeOut') {
    setSegmentProps(id, { [field]: value })
  } else {
    placeSegment(id, editedTransform(current.transform, field, value, linked))
  }
}

// Typed values commit on Enter or when the field loses focus; an entry that
// is not a number puts the current value back.
function onEnter(commit: (input: HTMLInputElement) => void) {
  return (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    commit(event.currentTarget as HTMLInputElement)
  }
}

// Exact placement and mix settings for the primary selected clip.
export function AdvancedInspector() {
  const aspectLinked = useSignal(true)
  const pending = useRef<PendingEntries>({ id: null, values: {} })
  const selectedId = advancedSelectedId.value

  // Clicking another clip re-renders these inputs for it before the focused one
  // blurs, so commit what was typed for the previous clip when the selection
  // changes rather than relying on that blur.
  useLayoutEffect(
    () => () => {
      const { id, values } = pending.current
      pending.current = { id: null, values: {} }
      if (!id) return
      for (const [field, text] of Object.entries(values) as [TypedField, string][]) {
        commitTypedValue(id, field, text, aspectLinked.peek())
      }
    },
    [selectedId]
  )

  const segment = advancedSegments.value.find((entry) => entry.id === selectedId)
  if (!segment) return null
  const count = advancedSelectedIds.value.length

  const id = segment.id
  const live = () => advancedSegments.value.find((entry) => entry.id === id)

  function noteTyped(field: TypedField, input: HTMLInputElement) {
    if (pending.current.id !== id) pending.current = { id, values: {} }
    pending.current.values[field] = input.value
  }

  function commitField(field: TypedField, input: HTMLInputElement) {
    // Only typed text commits: a focus pass would otherwise store the rounded
    // display value, or another clip's value after the selection changed.
    const typed = pending.current.id === id && field in pending.current.values
    if (typed) {
      delete pending.current.values[field]
      commitTypedValue(id, field, input.value, aspectLinked.value)
    }
    // Show what was stored (sizes have a minimum), or the old value for a bad entry.
    const stored = live()
    if (!stored) return
    input.value =
      field === 'fadeIn' || field === 'fadeOut'
        ? formatSeconds(stored[field] ?? 0)
        : String(Math.round(stored.transform[field]))
  }

  const opacityPercent = Math.round((segment.opacity ?? 1) * 100)
  const volumePercent = Math.round((segment.volume ?? 1) * 100)
  const duration = segmentDuration(segment)

  return (
    <section
      aria-label="Clip inspector"
      data-advanced-inspector
      class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-200/60 px-3 py-2 text-sm text-slate-600 dark:border-slate-700/60 dark:text-slate-300"
    >
      {count > 1 && (
        <span class="text-xs text-slate-500 dark:text-slate-400">
          Editing the last clicked of {count} selected
        </span>
      )}
      <div class="flex flex-wrap items-center gap-1.5">
        {BOX_FIELDS.map(({ field, label, name }) => (
          <label key={field} class="flex items-center gap-1">
            <span class="w-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
              {label}
            </span>
            <input
              type="number"
              step={1}
              min={field === 'width' || field === 'height' ? MIN_TRANSFORM_SIZE : undefined}
              value={String(Math.round(segment.transform[field]))}
              aria-label={name}
              class="w-20 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-sm text-slate-800 tabular-nums outline-none focus:border-violet-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onInput={(event) => noteTyped(field, event.currentTarget as HTMLInputElement)}
              onBlur={(event) => commitField(field, event.currentTarget as HTMLInputElement)}
              onKeyDown={onEnter((input) => commitField(field, input))}
            />
            {field === 'width' && (
              <button
                type="button"
                aria-pressed={aspectLinked.value}
                aria-label="Keep aspect ratio"
                title={
                  aspectLinked.value
                    ? 'Width and height keep the clip shape'
                    : 'Width and height change separately'
                }
                onClick={() => (aspectLinked.value = !aspectLinked.value)}
                class={clsx(
                  'ml-0.5 flex h-6 w-6 items-center justify-center rounded transition-colors hover:duration-0',
                  aspectLinked.value
                    ? 'bg-violet-500/10 text-violet-600 hover:bg-violet-500/20 dark:text-violet-300'
                    : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700/50'
                )}
              >
                {aspectLinked.value ? (
                  <Link2 class="h-3.5 w-3.5" />
                ) : (
                  <Unlink2 class="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </label>
        ))}
      </div>
      <PercentSlider
        label="Opacity"
        value={opacityPercent}
        onInput={(percent) => setSegmentProps(segment.id, { opacity: percent / 100 })}
      />
      <PercentSlider
        label="Volume"
        value={volumePercent}
        onInput={(percent) => setSegmentProps(segment.id, { volume: percent / 100 })}
      />
      <div class="flex items-center gap-3">
        {(
          [
            ['fadeIn', 'Fade in'],
            ['fadeOut', 'Fade out'],
          ] as const
        ).map(([field, label]) => (
          <label key={field} class="flex items-center gap-1.5">
            <span class="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</span>
            <input
              type="number"
              min={0}
              max={Number(duration.toFixed(2))}
              step={0.1}
              value={formatSeconds(segment[field] ?? 0)}
              aria-label={`${label} duration in seconds`}
              class="w-16 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-sm text-slate-800 tabular-nums outline-none focus:border-violet-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onInput={(event) => noteTyped(field, event.currentTarget as HTMLInputElement)}
              onBlur={(event) => commitField(field, event.currentTarget as HTMLInputElement)}
              onKeyDown={onEnter((input) => commitField(field, input))}
            />
            <span class="text-xs text-slate-500 dark:text-slate-400">s</span>
          </label>
        ))}
      </div>
    </section>
  )
}

function formatSeconds(seconds: number): string {
  return String(Number(seconds.toFixed(2)))
}

// A 0-100% range control. A pointer drag is one undo step (an armed gesture,
// ended by the global pointer release); key presses coalesce instead.
function PercentSlider({
  label,
  value,
  onInput,
}: {
  label: string
  value: number
  onInput: (percent: number) => void
}) {
  return (
    <label class="flex items-center gap-2">
      <span class="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        aria-label={label}
        aria-valuetext={`${value}%`}
        class="w-24 accent-violet-500"
        onPointerDown={() => beginAdvancedGesture()}
        onInput={(event) => onInput(Number((event.currentTarget as HTMLInputElement).value))}
      />
      <span class="w-9 text-right text-xs tabular-nums">{value}%</span>
    </label>
  )
}
