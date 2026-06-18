import { Upload } from 'lucide-preact'
import { useRef } from 'preact/hooks'

import { AdvancedTimeline } from '@/components/advanced/AdvancedTimeline'
import { AdvancedPreview } from '@/components/AdvancedPreview'
import { CanvasSizeControls } from '@/components/CanvasSizeControls'
import { advancedSegments } from '@/lib/store'
import { importIntoAdvanced } from '@/lib/videoImport'

const CARD =
  'rounded-lg border border-slate-200/60 bg-slate-50/40 backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/40'

export function AdvancedEditor() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hasContent = advancedSegments.value.length > 0

  async function onFileInputChange(event: Event) {
    const files = Array.from((event.target as HTMLInputElement).files ?? [])
    for (const file of files) await importIntoAdvanced(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function onDrop(event: DragEvent) {
    event.preventDefault()
    const files = Array.from(event.dataTransfer?.files ?? [])
    for (const file of files) await importIntoAdvanced(file)
  }

  return (
    <section
      aria-label="Advanced multi-track compositor"
      class="flex flex-col gap-3"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <div class={`flex flex-col gap-2 px-4 py-3 ${CARD}`}>
        <span class="text-sm font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
          Canvas
        </span>
        <CanvasSizeControls />
        <button
          onClick={() => fileInputRef.current?.click()}
          class="mt-1 inline-flex w-fit items-center gap-2 rounded bg-violet-500 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-violet-600 hover:duration-0"
        >
          <Upload class="h-4 w-4" />
          Add video
        </button>
      </div>

      {hasContent && <AdvancedPreview />}
      <AdvancedTimeline />

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,.mp4,.mkv,.mov,.webm"
        multiple
        class="hidden"
        onChange={onFileInputChange}
      />
    </section>
  )
}
