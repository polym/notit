// Log record shapes (architecture.md "Process Patterns": logs). The data payload may only carry
// ids, counts, error codes and durations so logs never leak highlight content (NFR16/17).

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Structured, content-free log payload. Allowed keys: id/ids, counts (count or *Count),
 * error codes (code or *Code) and durations (ms or *Ms). Text, comment and URL fields are
 * rejected at compile time.
 */
export type LogData = {
  id?: string
  ids?: readonly string[]
  count?: number
  code?: string
  ms?: number
  [count: `${string}Count`]: number
  [code: `${string}Code`]: string
  [duration: `${string}Ms`]: number
  // Explicitly forbidden content fields (also excluded by the absence of a generic string index).
  text?: never
  comment?: never
  url?: never
  exact?: never
  prefix?: never
  suffix?: never
  pageTitle?: never
  canonicalUrl?: never
}

export interface LogRecord {
  /** Auto-increment primary key; insertion order. */
  seq?: number
  ts: number
  level: LogLevel
  scope: string
  event: string
  data: LogData | null
}
