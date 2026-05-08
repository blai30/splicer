import { useSignal } from '@preact/signals'
import { clips, timeline } from '../lib/store'
import type { Clip, Segment } from '../lib/types'

const ACCEPTED = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/avi', 'video/mkv']

function isVideoFile(file: File): boolean {
  return ACCEPTED.includes(file.type) || /\.(mp4|webm|mov|avi|mkv)$/i.test(file.name)
}

async function importFile(file: File): Promise<void> {
  if (!isVideoFile(file)) return
  const objectUrl = URL.createObjectURL(file)
  const duration = await getVideoDuration(objectUrl)
  const thumbnail = await captureThumbnail(objectUrl)
  const clip: Clip = {
    id: crypto.randomUUID(),
    file,
    name: file.name.replace(/\.[^.]+$/, ''),
    duration,
    objectUrl,
    thumbnail,
  }
  clips.value = [...clips.value, clip]
}

function getVideoDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => resolve(v.duration)
    v.src = url
  })
}

function captureThumbnail(url: string): Promise<string> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.src = url
    v.currentTime = 0.5
    v.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 160
      canvas.height = 90
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(v, 0, 0, 160, 90)
      resolve(canvas.toDataURL('image/jpeg', 0.6))
    }
  })
}

function appendToTimeline(clip: Clip): void {
  const seg: Segment = {
    id: crypto.randomUUID(),
    clipId: clip.id,
    startTime: 0,
    endTime: clip.duration,
    muted: false,
  }
  timeline.value = [...timeline.value, seg]
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export function ClipLibrary() {
  const draggingOver = useSignal(false)

  function onDragOver(e: DragEvent) {
    e.preventDefault()
    draggingOver.value = true
  }

  function onDragLeave() {
    draggingOver.value = false
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault()
    draggingOver.value = false
    const files = Array.from(e.dataTransfer?.files ?? [])
    for (const f of files) await importFile(f)
  }

  async function onFileInput(e: Event) {
    const input = e.target as HTMLInputElement
    const files = Array.from(input.files ?? [])
    for (const f of files) await importFile(f)
    input.value = ''
  }

  return (
    <aside class="flex flex-col w-56 shrink-0 bg-mist-100 dark:bg-mist-800 border-r border-mist-200 dark:border-mist-700 overflow-hidden">
      <div class="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-mist-500 dark:text-mist-400 border-b border-mist-200 dark:border-mist-700">
        Clips
      </div>

      {/* Drop zone */}
      <div
        class={`mx-2 mt-2 flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed py-4 text-center cursor-pointer transition-colors ${
          draggingOver.value
            ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30'
            : 'border-mist-300 dark:border-mist-600 hover:border-emerald-400 dark:hover:border-emerald-500'
        }`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => document.getElementById('clip-file-input')?.click()}
      >
        <svg class="w-6 h-6 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        <span class="text-xs text-mist-500 dark:text-mist-400">
          Drop videos or click
        </span>
      </div>
      <input
        id="clip-file-input"
        type="file"
        accept="video/*"
        multiple
        class="hidden"
        onChange={onFileInput}
      />

      {/* Clip list */}
      <div class="flex-1 overflow-y-auto py-2 flex flex-col gap-1 px-2">
        {clips.value.length === 0 && (
          <p class="text-xs text-center text-mist-400 dark:text-mist-500 mt-4">
            No clips imported
          </p>
        )}
        {clips.value.map((clip) => (
          <button
            key={clip.id}
            class="group flex items-center gap-2 rounded-md p-1.5 text-left hover:bg-mist-200 dark:hover:bg-mist-700 transition-colors"
            onClick={() => appendToTimeline(clip)}
            title="Add to timeline"
          >
            <img
              src={clip.thumbnail}
              alt={clip.name}
              class="w-14 h-8 object-cover rounded shrink-0 bg-mist-300 dark:bg-mist-600"
            />
            <div class="min-w-0 flex-1">
              <p class="text-xs font-medium truncate text-mist-800 dark:text-mist-100">{clip.name}</p>
              <p class="text-xs text-mist-500 dark:text-mist-400">{formatDuration(clip.duration)}</p>
            </div>
          </button>
        ))}
      </div>
    </aside>
  )
}
