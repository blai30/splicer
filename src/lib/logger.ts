import { logs, LOG_LIMIT } from '@/lib/store'
import type { LogLevel } from '@/lib/store'

function nowIso() {
  return new Date().toISOString()
}

function pushEntry(level: LogLevel, message: string, meta?: any) {
  try {
    const entry = { id: crypto.randomUUID(), ts: nowIso(), level, message, meta }
    const next = [entry, ...logs.value]
    if (next.length > LOG_LIMIT) next.length = LOG_LIMIT
    logs.value = next
    return entry
  } catch (e) {
    // Best effort: do not fail app if logging breaks
    // eslint-disable-next-line no-console
    console.error('Logger push failed', e)
    return null
  }
}

export function log(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: any) {
  return pushEntry(level, message, meta)
}

export function debug(message: string, meta?: any) {
  return pushEntry('debug', message, meta)
}

export function info(message: string, meta?: any) {
  return pushEntry('info', message, meta)
}

export function warn(message: string, meta?: any) {
  return pushEntry('warn', message, meta)
}

export function error(message: string, meta?: any) {
  return pushEntry('error', message, meta)
}
