import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '../../db/schema.ts'
import { write } from '../../db/write.ts'
import {
  BACKOFF_STEPS_MS,
  backoffDelayMs,
  loadRetry,
  readSyncStatus,
  recordFailure,
  recordSuccess,
  resetBackoff,
  setSyncing,
} from './status.ts'

vi.stubGlobal('chrome', { runtime: { id: 'test', sendMessage: vi.fn(async () => undefined) } })

const server = { code: 'server' as const, message: '500' }

describe('backoff', () => {
  it('follows 30s / 1m / 2m / 5m and stays capped at 5m', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(backoffDelayMs)).toEqual([30_000, 60_000, 120_000, 300_000, 300_000, 300_000, 300_000])
    expect(BACKOFF_STEPS_MS).toEqual([30_000, 60_000, 120_000, 300_000])
  })

  it('treats step 0 as the first step', () => {
    expect(backoffDelayMs(0)).toBe(30_000)
  })
})

describe('retry state and syncStatus', () => {
  beforeEach(async () => {
    const db = getDb()
    await Promise.all(db.tables.map((t) => t.clear()))
    setSyncing(false)
  })

  it('consecutive failures walk the backoff and turn into error after 3', async () => {
    const delays: number[] = []
    for (let i = 0; i < 5; i++) delays.push(backoffDelayMs((await recordFailure(server)).backoffStep))
    expect(delays).toEqual([30_000, 60_000, 120_000, 300_000, 300_000])
  })

  it('reports error only after 3 consecutive failures, with lastError', async () => {
    await recordFailure(server)
    await recordFailure(server)
    expect((await readSyncStatus()).state).toBe('idle')
    await recordFailure(server)
    const status = await readSyncStatus()
    expect(status.state).toBe('error')
    expect(status.lastError).toEqual(server)
  })

  it('an auth failure is error at once', async () => {
    await recordFailure({ code: 'unauthenticated', message: 'jwt expired' })
    expect((await readSyncStatus()).state).toBe('error')
  })

  it('resetBackoff restarts the delay at 30s but keeps the failure count', async () => {
    await recordFailure(server)
    await recordFailure(server)
    await recordFailure(server)
    await resetBackoff()
    expect(await loadRetry()).toMatchObject({ failures: 3, backoffStep: 0 })
    expect(backoffDelayMs((await recordFailure(server)).backoffStep)).toBe(30_000)
  })

  it('a success clears failures and lastError', async () => {
    await recordFailure(server)
    await recordFailure(server)
    await recordFailure(server)
    await recordSuccess()
    const status = await readSyncStatus()
    expect(status.state).toBe('idle')
    expect(status.lastError).toBeUndefined()
  })

  it('pending is the outbox count; lastSyncAt comes from meta; syncing wins while running', async () => {
    await getDb().outbox.bulkPut([
      { id: 'a', editedAt: 1, attempts: 0 },
      { id: 'b', editedAt: 1, attempts: 0 },
    ])
    await write.setMeta('lastSyncAt', 1234)
    expect(await readSyncStatus()).toEqual({ state: 'idle', pending: 2, lastSyncAt: 1234 })
    setSyncing(true)
    expect((await readSyncStatus()).state).toBe('syncing')
  })

  it('a corrupt stored retry state reads as no failures', async () => {
    await write.setMeta('syncRetry', '{not json')
    expect(await loadRetry()).toEqual({ failures: 0, backoffStep: 0, lastError: null })
  })
})
