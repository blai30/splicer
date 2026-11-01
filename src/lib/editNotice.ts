import { signal } from '@preact/signals'

// A short message explaining why an edit did nothing (e.g. In pressed with the
// playhead outside the segment). Shown by the timeline, then cleared.
export const editNotice = signal<string | null>(null)

const NOTICE_MS = 3000
let clearTimer: ReturnType<typeof setTimeout> | null = null

export function showEditNotice(message: string) {
  if (clearTimer !== null) clearTimeout(clearTimer)
  editNotice.value = message
  clearTimer = setTimeout(() => {
    clearTimer = null
    editNotice.value = null
  }, NOTICE_MS)
}

export function clearEditNotice() {
  if (clearTimer !== null) clearTimeout(clearTimer)
  clearTimer = null
  editNotice.value = null
}
