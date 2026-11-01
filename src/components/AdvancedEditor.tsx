import { Upload } from 'lucide-preact'
import { useRef } from 'preact/hooks'

import { AdvancedTimeline } from '@/components/advanced/AdvancedTimeline'
import { AdvancedPreview } from '@/components/AdvancedPreview'
import { CanvasSizeControls } from '@/components/CanvasSizeControls'
import { FILE_INPUT_ACCEPT, importFilesIntoAdvanced } from '@/lib/videoImport'

const CARD =
  'rounded-lg border border-slate-200/60 bg-slate-50/40 backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/40'

export function AdvancedEditor() {
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function onFileInputChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ''
    await importFilesIntoAdvanced(files)
  }

  return (
    <section aria-label="Advanced multi-track compositor" class="flex flex-col gap-3">
      <div class={`flex flex-col gap-2 px-4 py-3 ${CARD}`}>
        <h2 class="text-sm font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
          Output size
        </h2>
        <CanvasSizeControls />
        <button
          onClick={() => fileInputRef.current?.click()}
          class="mt-1 inline-flex w-fit items-center gap-2 rounded bg-violet-500 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-violet-600 hover:duration-0"
        >
          <Upload class="h-4 w-4" />
          Add video
        </button>
      </div>

      <AdvancedPreview />
      <AdvancedTimeline />

      <input
        ref={fileInputRef}
        type="file"
        accept={FILE_INPUT_ACCEPT}
        multiple
        class="hidden"
        onChange={onFileInputChange}
        aria-label="Select video files to add to the composition"
      />
    </section>
  )
}
