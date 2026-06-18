import { Upload, X } from 'lucide-preact'
import { useRef } from 'preact/hooks'

import { AdvancedPreview } from '@/components/AdvancedPreview'
import { CanvasSizeControls } from '@/components/CanvasSizeControls'
import { clearAdvancedClip } from '@/lib/advanced/advancedEditing'
import { advancedSegments, getClipById } from '@/lib/store'
import { importIntoAdvanced } from '@/lib/videoImport'

export function AdvancedEditor() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const segments = advancedSegments.value
  const clip = segments.length > 0 ? getClipById(segments[0].clipId) : null

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
      class="flex flex-col gap-3 rounded-lg border border-slate-200/60 bg-slate-50/40 p-4 backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/40"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <CanvasSizeControls />

      {clip ? (
        <>
          <AdvancedPreview />
          <div class="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
            <span class="truncate font-medium">{clip.name}</span>
            <button
              onClick={() => fileInputRef.current?.click()}
              class="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-700/50"
            >
              <Upload class="h-4 w-4" />
              Replace
            </button>
            <button
              onClick={clearAdvancedClip}
              class="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30"
            >
              <X class="h-4 w-4" />
              Remove
            </button>
          </div>
        </>
      ) : (
        <button
          onClick={() => fileInputRef.current?.click()}
          class="flex min-h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300/70 text-slate-500 transition-colors hover:border-violet-400 hover:text-violet-600 dark:border-slate-700/70 dark:text-slate-400"
        >
          <Upload class="h-6 w-6" />
          <span class="text-sm">Click or drop a video to add it to the canvas</span>
        </button>
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
