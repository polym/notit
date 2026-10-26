import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '../../../core/db/schema.ts'
import type { HighlightRecord } from '../../../core/model/index.ts'
import { broadcastAuthChanged, broadcastCommitted } from './broadcast.ts'
import { badgeText } from './badge.ts'

const PAGE = 'https://example.com/post'

function record(overrides: Partial<HighlightRecord> = {}): HighlightRecord {
  return {
    id: crypto.randomUUID(),
    userId: '',
    canonicalUrl: PAGE,
    siteKey: 'example.com',
    url: PAGE,
    text: 'quote',
    color: 'yellow',
    comment: null,
    anchor: null,
    pageTitle: null,
    favicon: null,
    createdAt: 1,
    editedAt: 1,
    deviceId: 'd',
    deletedAt: null,
    schemaVersion: 1,
    ...overrides,
  }
}

function installChromeMock(tabs: chrome.tabs.Tab[], overrides: Record<string, 'on' | 'off'> = {}) {
  const chromeMock = {
    runtime: { id: 'ext' },
    storage: { local: { get: vi.fn(async () => ({ siteOverrides: overrides })) } },
    tabs: {
      query: vi.fn(async () => tabs),
      // Tab 3 has no content script: Chrome rejects with "Receiving end does not exist".
      sendMessage: vi.fn(async (tabId: number) => {
        if (tabId === 3) throw new Error('Could not establish connection. Receiving end does not exist.')
      }),
    },
    action: { setBadgeText: vi.fn(async () => {}), setBadgeBackgroundColor: vi.fn(async () => {}) },
  }
  vi.stubGlobal('chrome', chromeMock)
  return chromeMock
}

const tab = (id: number, url: string) => ({ id, url }) as chrome.tabs.Tab

// Vitest fails the run on any unhandled rejection, so a leaked sendMessage rejection fails these tests.
describe('broadcastCommitted', () => {
  beforeEach(async () => {
    await Promise.all(getDb().tables.map((t) => t.clear()))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends one page/sync to every tab with the same canonicalUrl and ignores failed sends', async () => {
    const live = record()
    const gone = record({ deletedAt: 5 })
    await getDb().highlights.bulkPut([live, gone])
    const chromeMock = installChromeMock([
      tab(1, `${PAGE}#sec`),
      tab(2, `${PAGE}?utm_source=x`),
      tab(3, `${PAGE}?fbclid=1#a`),
      tab(4, 'https://example.com/other'),
      tab(5, 'chrome://extensions'),
    ])
    await expect(broadcastCommitted([live, gone])).resolves.toBeUndefined()
    const targets = chromeMock.tabs.sendMessage.mock.calls.map((c) => c[0])
    expect(targets.sort()).toEqual([1, 2, 3])
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(1, {
      kind: 'noteit/event',
      type: 'page/sync',
      payload: { canonicalUrl: PAGE, upserts: [live], removes: [gone.id], enabled: true, signedIn: false },
    })
    expect(chromeMock.action.setBadgeText).toHaveBeenCalledWith({ text: '1', tabId: 2 })
    await new Promise((r) => setTimeout(r, 0))
  })

  it('delivers back-to-back delete then restore in commit order even when the first broadcast is slow', async () => {
    const id = crypto.randomUUID()
    const deleted = record({ id, editedAt: 2, deletedAt: 2 })
    const restored = record({ id, editedAt: 3, deletedAt: null })
    await getDb().highlights.put(restored)
    const chromeMock = installChromeMock([tab(1, PAGE)])
    // The delete broadcast's tabs.query resolves after the restore's: without serialization
    // the restore's page/sync would reach the tab first and the stale remove would win.
    let releaseFirst: () => void = () => {}
    chromeMock.tabs.query
      .mockImplementationOnce(
        () => new Promise<chrome.tabs.Tab[]>((resolve) => (releaseFirst = () => resolve([tab(1, PAGE)]))),
      )
      .mockImplementationOnce(async () => [tab(1, PAGE)])
    const first = broadcastCommitted([deleted])
    const second = broadcastCommitted([restored])
    await new Promise((r) => setTimeout(r, 10))
    releaseFirst()
    await Promise.all([first, second])
    const payloads = chromeMock.tabs.sendMessage.mock.calls.map(
      (c) => ((c as unknown[])[1] as { payload: { upserts: HighlightRecord[]; removes: string[] } }).payload,
    )
    expect(payloads.map((p) => ({ upserts: p.upserts.map((r) => r.id), removes: p.removes }))).toEqual([
      { upserts: [], removes: [id] },
      { upserts: [id], removes: [] },
    ])
  })

  it('a sign-in change sends an empty page/sync with signedIn to every http tab and recomputes badges', async () => {
    await getDb().highlights.put(record())
    const chromeMock = installChromeMock([tab(1, `${PAGE}#a`), tab(3, 'https://example.com/other'), tab(5, 'chrome://extensions')])
    await expect(broadcastAuthChanged(true)).resolves.toBeUndefined()
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledTimes(2)
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(1, {
      kind: 'noteit/event',
      type: 'page/sync',
      payload: { canonicalUrl: PAGE, upserts: [], removes: [], enabled: true, signedIn: true },
    })
    // The badge goes back to the count (replacing a '!' from a failed side panel open).
    expect(chromeMock.action.setBadgeText).toHaveBeenCalledWith({ text: '1', tabId: 1 })
    expect(chromeMock.action.setBadgeText).toHaveBeenCalledWith({ text: '', tabId: 3 })
    await new Promise((r) => setTimeout(r, 0))
  })

  it('does not reject when tabs.query fails', async () => {
    const chromeMock = installChromeMock([])
    chromeMock.tabs.query.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(broadcastCommitted([record()])).resolves.toBeUndefined()
  })
})

describe('badgeText', () => {
  beforeEach(async () => {
    await Promise.all(getDb().tables.map((t) => t.clear()))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('counts live highlights of the canonical page; empty for 0, disabled site or non-http', async () => {
    installChromeMock([])
    expect(await badgeText(PAGE)).toBe('')
    await getDb().highlights.bulkPut([record(), record(), record({ deletedAt: 3 })])
    expect(await badgeText(`${PAGE}?utm_source=x#sec`)).toBe('2')
    expect(await badgeText('https://example.com/other')).toBe('')
    expect(await badgeText('chrome://newtab')).toBe('')
    expect(await badgeText(undefined)).toBe('')
    installChromeMock([], { 'example.com': 'off' })
    expect(await badgeText(PAGE)).toBe('')
  })
})
