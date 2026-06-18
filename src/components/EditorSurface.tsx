import { AdvancedEditor } from '@/components/AdvancedEditor'
import { Timeline } from '@/components/Timeline'
import { VideoPreview } from '@/components/VideoPreview'
import { appMode } from '@/lib/store'

export function EditorSurface() {
  if (appMode.value === 'advanced') {
    return <AdvancedEditor />
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
