import { useEffect, useRef } from 'preact/hooks'

import { AdvancedSegmentBlock } from '@/components/advanced/AdvancedSegmentBlock'
import { AdvancedTrackHeaders } from '@/components/advanced/AdvancedTrackHeaders'
import { seek } from '@/lib/advanced/advancedPlayback'
import { moveSegment } from '@/lib/advanced/advancedSegmentEditing'
import { projectDuration } from '@/lib/advanced/advancedTimelineDomain'
import { advancedPlayhead, advancedSegments, advancedTracks, pxPerSec } from '@/lib/store'
import { createRafThrottler } from '@/lib/timelineDomain'

const LANE_HEIGHT = 56
const PAD_LEFT = 8

export function AdvancedTimeline() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrubThrottlerRef = useRef<ReturnType<typeof createRafThrottler> | null>(null)

  const tracks = advancedTracks.value
  const segments = advancedSegments.value
  const duration = projectDuration(segments)
  const contentWidth = Math.max(600, duration * pxPerSec.value + 200)
  const playheadLeft = PAD_LEFT + advancedPlayhead.value * pxPerSec.value

  // Map a viewport X to a timeline time, accounting for horizontal scroll.
  function timeFromClientX(clientX: number): number {
    const scroller = scrollRef.current
    if (!scroller) return 0
    const rect = scroller.getBoundingClientRect()
    return Math.max(0, (clientX - rect.left + scroller.scrollLeft - PAD_LEFT) / pxPerSec.value)
  }

  // Scrub the playhead: snap it to the cursor and follow until release. Pointer
  // capture is taken on the scroll container (a stable node that survives the
  // re-renders each seek triggers), so every move/up routes here instead of
  // leaking to the clip blocks underneath (which would otherwise start dragging
  // the clip and strand the capture, making the playhead stick to the cursor).
  function startScrub(event: PointerEvent, container: HTMLElement) {
    seek(timeFromClientX(event.clientX))
    container.setPointerCapture(event.pointerId)
    const throttler = createRafThrottler()
    scrubThrottlerRef.current = throttler

    function onMove(moveEvent: PointerEvent) {
      throttler.queue(() => seek(timeFromClientX(moveEvent.clientX)))
    }
    function onUp(upEvent: PointerEvent) {
      throttler.cancel()
      // Commit a final seek at the release point so a fast flick (whose last
      // throttled move was canceled above) still lands the playhead precisely.
      seek(timeFromClientX(upEvent.clientX))
      container.removeEventListener('pointermove', onMove)
      container.removeEventListener('pointerup', onUp)
      container.removeEventListener('pointercancel', onUp)
    }
    container.addEventListener('pointermove', onMove)
    container.addEventListener('pointerup', onUp)
    container.addEventListener('pointercancel', onUp)
  }

  function onTrackPointerDown(event: PointerEvent) {
    const target = event.target as HTMLElement
    // Clip blocks handle their own drag/trim/selection; a press anywhere else
    // (blank lane or the playhead) scrubs the playhead from that point.
    if (target.closest('[data-advanced-segment]')) return
    startScrub(event, event.currentTarget as HTMLElement)
  }

  // Cancel any pending throttled seek if we unmount mid-drag.
  useEffect(() => () => scrubThrottlerRef.current?.cancel(), [])

  function makeRequestMove(segmentId: string) {
    return (deltaTime: number, deltaLanes: number) => {
      const segment = advancedSegments.value.find((entry) => entry.id === segmentId)
      if (!segment) return
      const laneIndex = tracks.findIndex((track) => track.id === segment.trackId)
      const nextLane = Math.min(tracks.length - 1, Math.max(0, laneIndex + deltaLanes))
      const nextTrackId = tracks[nextLane]?.id ?? segment.trackId
      moveSegment(segmentId, nextTrackId, segment.timelineStart + deltaTime)
    }
  }

  return (
    <div class="flex shrink-0 flex-col gap-2 rounded-lg border border-slate-200/60 bg-slate-50/40 px-4 py-3 backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/40">
      <span class="text-sm font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
        Tracks
      </span>
      <div class="flex">
        <AdvancedTrackHeaders laneHeight={LANE_HEIGHT} />
        <div
          ref={scrollRef}
          class="relative min-h-0 flex-1 scrollbar-thin scrollbar-thumb-slate-400 scrollbar-track-transparent overflow-x-auto dark:scrollbar-thumb-slate-700"
          onPointerDown={onTrackPointerDown}
        >
          {/* spacer matching the headers' Add-track button row */}
          <div style={{ width: `${contentWidth}px` }}>
            <div class="h-7" />
            {tracks.map((track) => (
              <div
                key={track.id}
                class="relative border-b border-slate-200/40 dark:border-slate-700/40"
                style={{ height: `${LANE_HEIGHT}px` }}
              >
                {segments
                  .filter((segment) => segment.trackId === track.id)
                  .map((segment) => (
                    <AdvancedSegmentBlock
                      key={segment.id}
                      segment={segment}
                      laneHeight={LANE_HEIGHT}
                      onRequestMove={makeRequestMove(segment.id)}
                    />
                  ))}
              </div>
            ))}
            <div
              data-advanced-playhead
              class="absolute top-2 bottom-0 z-30 w-3 -translate-x-1/2 cursor-ew-resize"
              style={{ left: `${playheadLeft}px` }}
            >
              <div class="pointer-events-none absolute inset-x-0 top-0 bottom-0 flex justify-center">
                <div class="h-full w-0.5 bg-violet-400" />
              </div>
              <div class="pointer-events-none absolute top-0 left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1 rounded-full bg-violet-400" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
