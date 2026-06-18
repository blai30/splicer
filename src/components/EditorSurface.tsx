import { AdvancedPlaceholder } from '@/components/AdvancedPlaceholder'
import { Timeline } from '@/components/Timeline'
import { VideoPreview } from '@/components/VideoPreview'
import { appMode } from '@/lib/store'

export function EditorSurface() {
  if (appMode.value === 'advanced') {
    return <AdvancedPlaceholder />
  }
  return (
    <>
      <section aria-label="Video preview and playback controls">
        <VideoPreview />
      </section>
      <section aria-label="Timeline editor with segments">
        <Timeline />
      </section>
    </>
  )
}
