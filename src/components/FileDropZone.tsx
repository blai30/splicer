import { useSignal } from '@preact/signals'
import { Upload } from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'

import { consumeLaunchedFiles, type LaunchQueue } from '@/lib/launchQueue'
import { appMode } from '@/lib/store'
import { importFiles, importFilesIntoAdvanced, prefetchMediaProbe } from '@/lib/videoImport'

function importIntoActiveEditor(files: File[]) {
  if (appMode.value === 'advanced') void importFilesIntoAdvanced(files)
  else void importFiles(files)
}

function hasFiles(event: DragEvent): boolean {
  return [...(event.dataTransfer?.types ?? [])].includes('Files')
}

// The whole window accepts dropped video files and routes them to the active
// editor. Handling every drop here also stops the browser from navigating away
// to a file dropped outside an editor panel, which would discard the project.
export function FileDropZone() {
  const draggingOver = useSignal(false)
  const depth = useRef(0)

  useEffect(() => {
    // Warm the video reader once the page settles, so the first import does
    // not wait on it; a drag that arrives earlier warms it too.
    const idleHandle =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback(prefetchMediaProbe, { timeout: 5000 })
        : window.setTimeout(prefetchMediaProbe, 2000)

    // Videos opened from the OS with the installed app.
    consumeLaunchedFiles(window as { launchQueue?: LaunchQueue }, importIntoActiveEditor)

    function onDragEnter(event: DragEvent) {
      if (!hasFiles(event)) return
      event.preventDefault()
      prefetchMediaProbe()
      depth.current += 1
      draggingOver.value = true
    }

    function onDragOver(event: DragEvent) {
      if (!hasFiles(event)) return
      // Cancelling dragover marks the window as a valid drop target.
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }

    function onDragLeave(event: DragEvent) {
      if (!hasFiles(event) || depth.current === 0) return
      depth.current -= 1
      if (depth.current === 0) draggingOver.value = false
    }

    function onDrop(event: DragEvent) {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth.current = 0
      draggingOver.value = false
      importIntoActiveEditor(Array.from(event.dataTransfer?.files ?? []))
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(idleHandle)
      else window.clearTimeout(idleHandle)
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  if (!draggingOver.value) return null
  return (
    <div class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm">
      <div class="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-violet-400 bg-white/90 px-10 py-8 text-center shadow-xl dark:bg-slate-900/90">
        <Upload class="size-7 text-violet-500" />
        <p class="text-lg font-semibold text-violet-600 dark:text-violet-300">
          Drop video files to import
        </p>
        <p class="text-sm text-slate-500 dark:text-slate-400">MP4, MOV, MKV, or WebM</p>
      </div>
    </div>
  )
}
