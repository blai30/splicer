import { AdvancedSegmentBlock } from '@/components/advanced/AdvancedSegmentBlock'
import { AdvancedTrackHeaders } from '@/components/advanced/AdvancedTrackHeaders'
import { seek } from '@/lib/advanced/advancedPlayback'
import { moveSegment } from '@/lib/advanced/advancedSegmentEditing'
import { projectDuration } from '@/lib/advanced/advancedTimelineDomain'
import { advancedPlayhead, advancedSegments, advancedTracks, pxPerSec } from '@/lib/store'

const LANE_HEIGHT = 56
const PAD_LEFT = 8

export function AdvancedTimeline() {
  const tracks = advancedTracks.value
  const segments = advancedSegments.value
  const duration = projectDuration(segments)
  const contentWidth = Math.max(600, duration * pxPerSec.value + 200)
  const playheadLeft = PAD_LEFT + advancedPlayhead.value * pxPerSec.value

  function onLanesPointerDown(event: PointerEvent) {
    const target = event.target as HTMLElement
    if (target.closest('[data-advanced-segment]')) return
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const scrollLeft = (event.currentTarget as HTMLElement).scrollLeft
    const time = Math.max(0, (event.clientX - rect.left + scrollLeft - PAD_LEFT) / pxPerSec.value)
    seek(time)
  }

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
          class="relative min-h-0 flex-1 scrollbar-thin scrollbar-thumb-slate-400 scrollbar-track-transparent overflow-x-auto dark:scrollbar-thumb-slate-700"
          onPointerDown={onLanesPointerDown}
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
              class="pointer-events-none absolute top-7 bottom-0 z-30 w-0.5 -translate-x-1/2 bg-violet-400"
              style={{ left: `${playheadLeft}px` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
