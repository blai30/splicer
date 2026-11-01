// Folds a burst of small repeated edits (e.g. holding a nudge key) into one
// undo entry. A call records history unless the previous call had the same key,
// came within `windowMs`, and no other history entry was recorded in between
// (`generation` changes on every record/undo/redo), so unrelated edits are
// never swallowed into the burst.
export type CoalescingHistoryOptions = {
  record: () => void
  generation: () => number
  windowMs?: number
  now?: () => number
}

export const COALESCE_WINDOW_MS = 500

export function createCoalescingHistory({
  record,
  generation,
  windowMs = COALESCE_WINDOW_MS,
  now = () => performance.now(),
}: CoalescingHistoryOptions): (key: string) => void {
  let lastKey: string | null = null
  let lastAt = -Infinity
  let lastGeneration = -1

  return (key: string) => {
    const at = now()
    const continuesBurst =
      key === lastKey && at - lastAt <= windowMs && generation() === lastGeneration
    if (!continuesBurst) record()
    lastKey = key
    lastAt = at
    lastGeneration = generation()
  }
}
