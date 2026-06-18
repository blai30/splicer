import { Upload, X } from 'lucide-preact'
import { useRef } from 'preact/hooks'

import { AdvancedPreview } from '@/components/AdvancedPreview'
import { CanvasSizeControls } from '@/components/CanvasSizeControls'
import { clearAdvancedClip } from '@/lib/advanced/advancedEditing'
import { advancedSegments, getClipById } from '@/lib/store'
import { importIntoAdvanced } from '@/lib/videoImport'

const CARD =
  'rounded-lg border border-slate-200/60 bg-slate-50/40 backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/40'

export function AdvancedEditor() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const segments = advancedSegments.value
  const clip = segments.length > 0 ? getClipById(segments[0].clipId) : null

  function browse() {
    fileInputRef.current?.click()
  }

  async function onFileInputChange(event: Event) {
    const files = Array.from((event.target as HTMLInputElement).files ?? [])
    if (files[0]) await importIntoAdvanced(files[0])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function onDrop(event: DragEvent) {
    event.preventDefault()
    const file = event.dataTransfer?.files?.[0]
    if (file) await importIntoAdvanced(file)
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
      </div>

      {clip ? (
        <>
          <AdvancedPreview />
          <div class={`flex items-center gap-1 px-3 py-2 ${CARD}`}>
            <span class="mr-auto truncate text-sm font-medium text-slate-600 dark:text-slate-300">
              {clip.name}
            </span>
            <button
              onClick={browse}
              class="inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 hover:duration-0 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-slate-100"
            >
              <Upload class="h-4 w-4" />
              Replace
            </button>
            <button
              onClick={clearAdvancedClip}
              class="inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium text-slate-600 transition-colors hover:bg-red-100 hover:text-red-600 hover:duration-0 dark:text-slate-300 dark:hover:bg-red-900/30 dark:hover:text-red-400"
            >
              <X class="h-4 w-4" />
              Remove
            </button>
          </div>
        </>
      ) : (
        <div class={`flex flex-col overflow-hidden ${CARD}`}>
          <div class="flex min-h-64 flex-col items-center justify-center gap-3 bg-slate-200 dark:bg-slate-950">
            <p class="text-base text-slate-500 select-none">
              Drop a video onto the canvas, or browse to add one
            </p>
            <button
              onClick={browse}
              class="inline-flex h-10 items-center justify-center gap-2 rounded bg-violet-500 px-4 text-base font-semibold text-white transition-colors hover:bg-violet-600 hover:duration-0"
            >
              <Upload class="h-4 w-4" />
              Add video
            </button>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,.mp4,.mkv,.mov,.webm"
        class="hidden"
        onChange={onFileInputChange}
      />
    </section>
  )
}
