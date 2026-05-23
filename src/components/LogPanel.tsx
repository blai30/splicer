import { useSignal } from '@preact/signals'
import { Trash, ChevronDown, ChevronUp } from 'lucide-preact'

import { logs, logPanelVisible, clearLogs } from '@/lib/store'

function levelClass(level: string) {
  switch (level) {
    case 'debug':
      return 'text-slate-500'
    case 'info':
      return 'text-sky-600'
    case 'warn':
      return 'text-amber-600'
    case 'error':
      return 'text-red-600'
    default:
      return 'text-slate-600'
  }
}

export function LogPanel() {
  const search = useSignal('')
  const levelFilters = useSignal({ debug: true, info: true, warn: true, error: true })
  const LEVELS: Array<'debug' | 'info' | 'warn' | 'error'> = ['debug', 'info', 'warn', 'error']

  function toggleLevel(l: keyof typeof levelFilters.value) {
    levelFilters.value = { ...levelFilters.value, [l]: !levelFilters.value[l] }
  }

  function matchesSearch(e: any) {
    const q = search.value.trim().toLowerCase()
    if (!q) return true
    if (e.message.toLowerCase().includes(q)) return true
    try {
      if (e.meta && JSON.stringify(e.meta).toLowerCase().includes(q)) return true
    } catch {}
    return false
  }

  const filtered = logs.value.filter((e) => levelFilters.value[e.level] && matchesSearch(e))

  return (
    <div class="flex shrink-0 flex-col gap-3 rounded-lg border border-slate-200/60 bg-slate-50/40 px-4 py-3 backdrop-blur dark:border-slate-700/60 dark:bg-slate-900/40">
      <button
        onClick={() => (logPanelVisible.value = !logPanelVisible.value)}
        class="flex w-full items-center justify-between gap-2"
      >
        <div class="flex items-center gap-3">
          <span class="text-sm font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
            Logs
          </span>
          <span class="hidden text-sm text-slate-500 sm:block dark:text-slate-400">Runtime</span>
        </div>
        <div class="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <span class="text-xs">{logs.value.length} entries</span>
          {logPanelVisible.value ? <ChevronUp class="h-4 w-4" /> : <ChevronDown class="h-4 w-4" />}
        </div>
      </button>

      {logPanelVisible.value && (
        <div class="grid gap-2">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  onClick={() => toggleLevel(l)}
                  class={`rounded px-2 py-1 text-xs font-medium ${levelFilters.value[l] ? 'bg-violet-500 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700/50'} transition-colors hover:duration-0`}
                >
                  {l}
                </button>
              ))}
            </div>

            <div class="flex items-center gap-2">
              <input
                type="search"
                value={search.value}
                onInput={(e: any) => (search.value = e.target.value)}
                placeholder="Search logs..."
                class="rounded border border-slate-200/60 px-2 py-1 text-sm text-slate-700 placeholder:text-slate-400 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-200"
              />
              <button
                onClick={() => clearLogs()}
                class="inline-flex items-center gap-2 rounded px-2 py-1 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:duration-0 dark:text-slate-300 dark:hover:bg-slate-800"
                aria-label="Clear logs"
                title="Clear logs"
              >
                <Trash class="h-4 w-4" />
                Clear
              </button>
            </div>
          </div>

          <div class="max-h-120 scrollbar-thumb-slate-400/80 scrollbar-track-transparent overflow-auto px-1 py-1 text-sm dark:scrollbar-thumb-slate-600/80">
            {filtered.length === 0 ? (
              <div class="text-slate-500 dark:text-slate-400">No log entries</div>
            ) : (
              filtered.map((e) => (
                <div class="mb-2 wrap-break-word" key={e.id}>
                  <div class="flex items-baseline gap-2">
                    <div class="text-xs text-slate-400">{new Date(e.ts).toLocaleTimeString()}</div>
                    <div
                      class={`${levelClass(e.level)} text-xs font-medium tracking-wide uppercase`}
                    >
                      {e.level}
                    </div>
                    <div class="text-slate-700 dark:text-slate-100">{e.message}</div>
                  </div>
                  {e.meta && (
                    <pre class="mt-1 max-w-full overflow-auto rounded bg-slate-100 p-2 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {JSON.stringify(e.meta, null, 2)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default LogPanel
