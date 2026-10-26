import { beforeEach, describe, expect, it } from 'vitest'
import { LOG_CAPACITY, clearLogs, flushLogs, log, readLogs } from './index.ts'

describe('core/log ring buffer', () => {
  beforeEach(async () => {
    await clearLogs()
  })

  it('stores structured entries with level, scope, event and data', async () => {
    log.info('sync', 'push/done', { count: 3, ms: 12 })
    log.error('db', 'write/failed', { id: 'h1', code: 'quota' })
    const entries = await readLogs()
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ level: 'info', scope: 'sync', event: 'push/done', data: { count: 3, ms: 12 } })
    expect(entries[1]).toMatchObject({ level: 'error', scope: 'db', event: 'write/failed', data: { id: 'h1', code: 'quota' } })
    expect(typeof entries[0].ts).toBe('number')
  })

  it('evicts the oldest entries once more than 1,000 are written', async () => {
    const total = LOG_CAPACITY + 25
    for (let i = 0; i < total; i++) log.debug('test', 'tick', { count: i })
    await flushLogs()
    const entries = await readLogs()
    expect(entries).toHaveLength(LOG_CAPACITY)
    expect(entries[0].data?.count).toBe(25)
    expect(entries.at(-1)?.data?.count).toBe(total - 1)
  })

  it('records data null when no payload is given and never throws', async () => {
    expect(() => log.warn('auth', 'session/expired')).not.toThrow()
    const [entry] = await readLogs()
    expect(entry.data).toBeNull()
  })

  it('clearLogs empties the buffer', async () => {
    log.info('x', 'y')
    await clearLogs()
    expect(await readLogs()).toEqual([])
  })
})
