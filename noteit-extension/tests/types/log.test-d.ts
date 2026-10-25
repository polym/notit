// Compile-time contract for core/log (Story 2.4): log data may carry ids, counts, error codes
// and durations only. Checked by `tsc -b` via tsconfig.tests.json; every @ts-expect-error must
// stay an error, otherwise tsc fails on the unused directive.
import { log, type LogData } from '../../src/core/log/index.ts'

export function logTypeContract(): void {
  log.info('sync', 'push/done', { ids: ['a', 'b'], count: 2, ms: 30 })
  log.error('db', 'write/failed', { id: 'a', code: 'quota', retryCount: 1, errorCode: 'QuotaExceededError', elapsedMs: 4 })
  log.debug('sw', 'start')

  // @ts-expect-error highlight text must never be logged
  log.info('highlight', 'create', { text: 'secret passage' })
  // @ts-expect-error comments must never be logged
  log.info('highlight', 'edit', { comment: 'private note' })
  // @ts-expect-error full URLs must never be logged
  log.info('page', 'open', { url: 'https://example.com/a' })
  // @ts-expect-error arbitrary string fields are not allowed
  log.info('page', 'open', { title: 'Example' })
  // @ts-expect-error counts must be numbers
  log.info('sync', 'pull', { count: '3' })

  // Non-literal payloads are checked as well (not only excess-property checks on literals).
  const withText = { id: 'a', text: 'secret' }
  // @ts-expect-error text field in a variable is rejected
  const data: LogData = withText
  void data
}
