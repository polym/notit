import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STORAGE_KEYS,
  clearSiteOverrides,
  getDeviceId,
  getSiteOverride,
  getSiteOverrides,
  resetDeviceIdCache,
  setSiteOverride,
} from './index.ts'

// Minimal in-memory chrome.storage.local with the promise-based API.
function installStorageMock() {
  const store = new Map<string, unknown>()
  const local = {
    get: vi.fn(async (key: string) => (store.has(key) ? { [key]: structuredClone(store.get(key)) } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v))
    }),
    remove: vi.fn(async (key: string) => {
      store.delete(key)
    }),
  }
  vi.stubGlobal('chrome', { storage: { local } })
  return { store, local }
}

describe('core/settings deviceId', () => {
  let mock: ReturnType<typeof installStorageMock>
  beforeEach(() => {
    mock = installStorageMock()
    resetDeviceIdCache()
  })

  it('generates and persists an id on first call, then returns the same value', async () => {
    const first = await getDeviceId()
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(mock.store.get(STORAGE_KEYS.deviceId)).toBe(first)
    expect(await getDeviceId()).toBe(first)
  })

  it('reuses the persisted id after the in-memory cache is gone (new SW instance)', async () => {
    const first = await getDeviceId()
    resetDeviceIdCache()
    expect(await getDeviceId()).toBe(first)
    expect(mock.local.set).toHaveBeenCalledTimes(1)
  })

  it('concurrent first calls produce a single id', async () => {
    const [a, b] = await Promise.all([getDeviceId(), getDeviceId()])
    expect(a).toBe(b)
    expect(mock.local.set).toHaveBeenCalledTimes(1)
  })

  it('keeps an existing stored id', async () => {
    mock.store.set(STORAGE_KEYS.deviceId, 'existing-device')
    expect(await getDeviceId()).toBe('existing-device')
    expect(mock.local.set).not.toHaveBeenCalled()
  })
})

describe('core/settings siteOverrides', () => {
  let mock: ReturnType<typeof installStorageMock>
  beforeEach(() => {
    mock = installStorageMock()
  })

  it('is empty by default', async () => {
    expect(await getSiteOverrides()).toEqual({})
    expect(await getSiteOverride('example.com')).toBeNull()
  })

  it('sets, reads and removes per-site overrides', async () => {
    await setSiteOverride('example.com', 'on')
    await setSiteOverride('docs.example.com', 'off')
    expect(await getSiteOverrides()).toEqual({ 'example.com': 'on', 'docs.example.com': 'off' })
    expect(await getSiteOverride('docs.example.com')).toBe('off')

    await setSiteOverride('example.com', null)
    expect(await getSiteOverrides()).toEqual({ 'docs.example.com': 'off' })

    await clearSiteOverrides()
    expect(mock.store.has(STORAGE_KEYS.siteOverrides)).toBe(false)
  })

  it('serializes overlapping writes so no update is lost', async () => {
    await Promise.all([setSiteOverride('a.com', 'on'), setSiteOverride('b.com', 'off')])
    expect(await getSiteOverrides()).toEqual({ 'a.com': 'on', 'b.com': 'off' })

    await Promise.all([clearSiteOverrides(), setSiteOverride('c.com', 'on')])
    expect(await getSiteOverrides()).toEqual({ 'c.com': 'on' })
  })

  it('keeps serializing after a failed write', async () => {
    mock.local.set.mockRejectedValueOnce(new Error('quota'))
    const results = await Promise.allSettled([setSiteOverride('a.com', 'on'), setSiteOverride('b.com', 'off')])
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled'])
    expect(await getSiteOverrides()).toEqual({ 'b.com': 'off' })
  })

  it('drops malformed stored values', async () => {
    mock.store.set(STORAGE_KEYS.siteOverrides, { 'a.com': 'on', 'b.com': 'maybe', 'c.com': 1 })
    expect(await getSiteOverrides()).toEqual({ 'a.com': 'on' })
    mock.store.set(STORAGE_KEYS.siteOverrides, ['a.com'])
    expect(await getSiteOverrides()).toEqual({})
  })

  it('does not treat inherited object keys as overrides', async () => {
    expect(await getSiteOverride('toString')).toBeNull()
  })
})
