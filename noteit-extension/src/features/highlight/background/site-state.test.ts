import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '../../../core/db/schema.ts'
import { read } from '../../../core/db/read.ts'
import { write } from '../../../core/db/write.ts'
import { STORAGE_KEYS, setSiteOverride } from '../../../core/settings/index.ts'
import type { HighlightRecord } from '../../../core/model/index.ts'
import { ensureSiteEnabled, isSiteEnabled, siteEnabledRule } from './site-state.ts'

function installChromeMock() {
  const store = new Map<string, unknown>()
  vi.stubGlobal('chrome', {
    runtime: { id: 'noteit-test-id' },
    storage: {
      local: {
        get: vi.fn(async (key: string) => (store.has(key) ? { [key]: structuredClone(store.get(key)) } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v))
        }),
        remove: vi.fn(async (key: string) => void store.delete(key)),
      },
    },
  })
  return store
}

async function seedLive(site: string): Promise<HighlightRecord> {
  const { record } = await write.insertIfAbsent(
    {
      id: crypto.randomUUID(),
      userId: '',
      url: `https://${site}/a`,
      canonicalUrl: `https://${site}/a`,
      siteKey: site,
      text: 'quoted',
      color: 'yellow',
      comment: null,
      anchor: null,
      pageTitle: null,
      favicon: null,
      createdAt: Date.now(),
      deletedAt: null,
      schemaVersion: 1,
    },
    'device-1',
  )
  return record
}

describe('site enable rule (D8)', () => {
  it('covers the four combinations', () => {
    // No override: follows hasHighlights.
    expect(siteEnabledRule(null, true)).toBe(true)
    expect(siteEnabledRule(null, false)).toBe(false)
    // 'on' enables without highlights; 'off' disables even with highlights.
    expect(siteEnabledRule('on', false)).toBe(true)
    expect(siteEnabledRule('off', true)).toBe(false)
  })
})

describe('isSiteEnabled / ensureSiteEnabled', () => {
  let store: Map<string, unknown>
  beforeEach(async () => {
    store = installChromeMock()
    const db = getDb()
    await Promise.all(db.tables.map((t) => t.clear()))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reads the override and the live highlights of the site', async () => {
    expect(await isSiteEnabled('example.com')).toBe(false)
    await seedLive('example.com')
    expect(await isSiteEnabled('example.com')).toBe(true)
    await setSiteOverride('example.com', 'off')
    expect(await isSiteEnabled('example.com')).toBe(false)
    await setSiteOverride('other.com', 'on')
    expect(await isSiteEnabled('other.com')).toBe(true)
    // Overrides are per siteKey: a subdomain is a different site.
    expect(await isSiteEnabled('docs.other.com')).toBe(false)
  })

  it('ensureSiteEnabled writes on for a closed site and leaves an enabled one untouched', async () => {
    await setSiteOverride('closed.com', 'off')
    expect(await ensureSiteEnabled('closed.com')).toBe(true)
    expect(store.get(STORAGE_KEYS.siteOverrides)).toEqual({ 'closed.com': 'on' })

    await seedLive('auto.com')
    expect(await ensureSiteEnabled('auto.com')).toBe(false)
    expect(store.get(STORAGE_KEYS.siteOverrides)).toEqual({ 'closed.com': 'on' })
  })

  it('siteOverrides never enters the synced data (records, outbox, db tables)', async () => {
    await setSiteOverride('example.com', 'off')
    const record = await seedLive('example.com')
    // Until core/sync/mapping.ts exists (Story 2.16), the synced payload is the record plus its outbox row.
    expect(Object.keys(record)).not.toContain('siteOverrides')
    for (const item of await read.outboxItems()) expect(Object.keys(item)).not.toContain('siteOverrides')
    expect(getDb().tables.map((t) => t.name)).not.toContain('siteOverrides')
    expect(JSON.stringify(await read.byId(record.id))).not.toContain('example.com":"off')
  })
})
