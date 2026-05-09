import { useSignal, useSignalEffect } from '@preact/signals'
import { Volume2, VolumeX } from 'lucide-preact'
import { useRef } from 'preact/hooks'

import { previewMuted, previewVolume } from '@/lib/store'

export function VolumeControl() {
  const localVolume = useSignal(previewVolume.value)
  const inputRef = useRef<HTMLInputElement>(null)

  useSignalEffect(() => {
    localVolume.value = previewVolume.value
    if (inputRef.current) {
      inputRef.current.value = String(previewVolume.value)
    }
  })

  return (
    <div class="flex items-center gap-2">
      <button
        onClick={() => {
          previewMuted.value = !previewMuted.value
        }}
        class="flex h-7 w-7 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
        title={previewMuted.value ? 'Unmute preview' : 'Mute preview'}
      >
        {previewMuted.value ? <VolumeX class="h-4 w-4" /> : <Volume2 class="h-4 w-4" />}
      </button>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        ref={inputRef}
        value={localVolume.value}
        disabled={previewMuted.value}
        onInput={(e) => {
          const val = Number((e.currentTarget as HTMLInputElement).value)
          localVolume.value = val
          previewVolume.value = val
        }}
        class="w-20 accent-violet-500 disabled:opacity-40"
        title="Preview volume"
      />
    </div>
  )
}
