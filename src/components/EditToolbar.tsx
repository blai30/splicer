import { clips, playheadTime, selectedSegmentId, timeline } from '@/lib/store'

export function EditToolbar() {
  const seg = timeline.value.find((s) => s.id === selectedSegmentId.value)

  function setInPoint() {
    if (!seg) return
    const t = playheadTime.value
    timeline.value = timeline.value.map((s) =>
      s.id === seg.id ? { ...s, startTime: Math.max(0, Math.min(t, s.endTime - 0.1)) } : s
    )
  }

  function setOutPoint() {
    if (!seg) return
    const t = playheadTime.value
    const clipDur = clips.value.find((c) => c.id === seg.clipId)?.duration ?? t
    timeline.value = timeline.value.map((s) =>
      s.id === seg.id ? { ...s, endTime: Math.min(clipDur, Math.max(t, s.startTime + 0.1)) } : s
    )
  }

  function cutAtPlayhead() {
    if (!seg) return
    const t = playheadTime.value
    if (t <= seg.startTime || t >= seg.endTime) return

    const first = { ...seg, endTime: t }
    const second = { ...seg, id: crypto.randomUUID(), startTime: t }
    timeline.value = timeline.value.flatMap((s) => (s.id === seg.id ? [first, second] : [s]))
    selectedSegmentId.value = second.id
  }

  function toggleMute() {
    if (!seg) return
    timeline.value = timeline.value.map((s) => (s.id === seg.id ? { ...s, muted: !s.muted } : s))
  }

  function deleteSegment() {
    if (!seg) return
    timeline.value = timeline.value.filter((s) => s.id !== seg.id)
    selectedSegmentId.value = null
  }

  const disabled = !seg

  const btnBase =
    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  const btnPrimary = `${btnBase} bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-300 dark:hover:bg-slate-700`
  const btnDanger = `${btnBase} bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/60`

  return (
    <div class="flex shrink-0 items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 dark:bg-slate-900">
      <button class={btnPrimary} disabled={disabled} onClick={setInPoint} title="Set in-point (I)">
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 4v16h2V4H6zm4 8 8 5V7l-8 5z" />
        </svg>
        In
      </button>

      <button
        class={btnPrimary}
        disabled={disabled}
        onClick={setOutPoint}
        title="Set out-point (O)"
      >
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M16 4v16h2V4h-2zM6 7v10l8-5-8-5z" />
        </svg>
        Out
      </button>

      <button
        class={btnPrimary}
        disabled={disabled}
        onClick={cutAtPlayhead}
        title="Split at playhead (C)"
      >
        <svg
          class="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path stroke-linecap="round" d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" />
        </svg>
        Cut
      </button>

      <button class={btnPrimary} disabled={disabled} onClick={toggleMute} title="Toggle mute">
        <svg
          class="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          {seg?.muted ? (
            <>
              <path stroke-linecap="round" stroke-linejoin="round" d="M11 5L6 9H2v6h4l5 4V5z" />
              <path stroke-linecap="round" d="M23 9l-6 6M17 9l6 6" />
            </>
          ) : (
            <>
              <path stroke-linecap="round" stroke-linejoin="round" d="M11 5L6 9H2v6h4l5 4V5z" />
              <path
                stroke-linecap="round"
                d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"
              />
            </>
          )}
        </svg>
        {seg?.muted ? 'Unmute' : 'Mute'}
      </button>

      <div class="flex-1" />

      <button class={btnDanger} disabled={disabled} onClick={deleteSegment} title="Delete segment">
        <svg
          class="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
          />
        </svg>
        Delete
      </button>
    </div>
  )
}
