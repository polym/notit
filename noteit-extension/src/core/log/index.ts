// Ring-buffer logger (architecture.md "Process Patterns": logs). Writes to the Dexie logs table,
// keeps the newest LOG_CAPACITY entries and mirrors to console in development builds.
// Logging never throws and never needs to be awaited; use flush() when ordering matters (tests).
import { getDb } from '../db/schema.ts'
import type { LogData, LogLevel, LogRecord } from './types.ts'

export type { LogData, LogLevel, LogRecord } from './types.ts'

export const LOG_CAPACITY = 1000

let queue: Promise<void> = Promise.resolve()

function isDev(): boolean {
  return import.meta.env.DEV === true
}

async function append(record: LogRecord): Promise<void> {
  const db = getDb()
  await db.transaction('rw', db.logs, async () => {
    await db.logs.add(record)
    const overflow = (await db.logs.count()) - LOG_CAPACITY
    if (overflow > 0) {
      const oldest = await db.logs.orderBy('seq').limit(overflow).primaryKeys()
      await db.logs.bulkDelete(oldest)
    }
  })
}

function write(level: LogLevel, scope: string, event: string, data?: LogData): void {
  const record: LogRecord = { ts: Date.now(), level, scope, event, data: data ? { ...data } : null }
  if (isDev()) {
    const method = level === 'debug' ? 'debug' : level
    console[method](`[NoteIt] ${scope} ${event}`, data ?? '')
  }
  // Serialize writes so trimming is deterministic; a failed write is dropped, not rethrown.
  queue = queue.then(() => append(record)).catch(() => {})
}

export const log = {
  debug: (scope: string, event: string, data?: LogData): void => write('debug', scope, event, data),
  info: (scope: string, event: string, data?: LogData): void => write('info', scope, event, data),
  warn: (scope: string, event: string, data?: LogData): void => write('warn', scope, event, data),
  error: (scope: string, event: string, data?: LogData): void => write('error', scope, event, data),
}

/** Resolves once every log call made so far has been written (or dropped). */
export function flushLogs(): Promise<void> {
  return queue
}

/** Returns the buffered entries, oldest first (diagnostics page and debug/dump). */
export async function readLogs(): Promise<LogRecord[]> {
  await flushLogs()
  return getDb().logs.orderBy('seq').toArray()
}

/** Empties the buffer (sign-out wipe). */
export async function clearLogs(): Promise<void> {
  await flushLogs()
  await getDb().logs.clear()
}
