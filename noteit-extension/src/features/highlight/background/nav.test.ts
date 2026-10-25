import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, type Result } from '../../../core/messaging/index.ts'
import { getDb } from '../../../core/db/schema.ts'
import { read } from '../../../core/db/read.ts'
import { flushLogs } from '../../../core/log/index.ts'
import { resetDeviceIdCache } from '../../../core/settings/index.ts'
import type { HighlightRecord } from '../../../core/model/index.ts'
import { anchorHandlers, highlightHandlers } from './handlers.ts'
import { pickTab } from './nav.ts'
import { setSignedInSource } from './auth-gate.ts'
import type { AnchorRequests, CreateHighlightReq, HighlightRequests } from '../shared/protocol.ts'

const EXTENSION_ID = 'noteit-test-id'
const self = { id: EXTENSION_ID } as chrome.runtime.MessageSender
const PAGE = 'https://example.com/post'

interface Tab {
  id: number
  url: string
  windowId: number
}

function installChromeMock(tabs: Tab[], flash: (tabId: number) => unknown) {
  const store = new Map<string, unknown>()
  const chromeMock = {
    runtime: { id: EXTENSION_ID, sendMessage: vi.fn(async () => undefined) },
    tabs: {
      query: vi.fn(async () => tabs),
      update: vi.fn(async (id: number) => tabs.find((t) => t.id === id)),
      create: vi.fn(async (props: { url: string; windowId?: number }) => {
        const tab = { id: 99, url: props.url, windowId: props.windowId ?? 1 }
        tabs.push(tab)
        return tab
      }),
      sendMessage: vi.fn(async (tabId: number, message: { kind?: string; type?: string }) =>
        message.type === 'page/flash' ? flash(tabId) : undefined,
      ),
    },
    windows: { getLastFocused: vi.fn(async () => ({ id: 1 })), update: vi.fn(async () => ({})) },
    action: { setBadgeText: vi.fn(async () => {}), setBadgeBackgroundColor: vi.fn(async () => {}) },
    storage: {
      local: {
        get: vi.fn(async (key: string) => (store.has(key) ? { [key]: structuredClone(store.get(key)) } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v))
        }),
      },
    },
  }
  vi.stubGlobal('chrome', chromeMock)
  return chromeMock
}

type All = HighlightRequests & AnchorRequests
const router = createRouter<All>({ ...highlightHandlers, ...anchorHandlers })

async function call<T>(type: keyof All, req: unknown): Promise<T> {
  const r = (await router.handle({ kind: 'noteit/request', type, req }, self)) as Result<T>
  if (!r.ok) throw new Error(`${type} failed: ${r.error.code}`)
  return r.data
}

function createReq(url = PAGE): CreateHighlightReq {
  return {
    id: crypto.randomUUID(),
    url,
    text: 'quoted text',
    color: 'yellow',
    comment: 'note',
    anchor: null,
    pageTitle: null,
    favicon: null,
  }
}

async function lostRows(): Promise<string[]> {
  return read.lostIds()
}

describe('pickTab', () => {
  const tabs = [
    { id: 1, url: 'https://example.com/post#a', windowId: 2 },
    { id: 2, url: 'https://example.com/post?utm_source=x', windowId: 1 },
    { id: 3, url: 'https://example.com/other', windowId: 1 },
  ]
  it('prefers the current window, then any window, else none', () => {
    expect(pickTab(tabs, PAGE, 1)?.id).toBe(2)
    expect(pickTab(tabs, PAGE, 2)?.id).toBe(1)
    expect(pickTab(tabs.slice(0, 1), PAGE, 1)?.id).toBe(1)
    expect(pickTab(tabs, 'https://example.com/none', 1)).toBeUndefined()
  })
})

describe('anchor/report and nav/jumpTo', () => {
  beforeEach(async () => {
    setSignedInSource(async () => true)
    resetDeviceIdCache()
    await flushLogs()
    const db = getDb()
    await Promise.all(db.tables.map((t) => t.clear()))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('anchor/report writes and deletes anchorStatus only for records of the reported page', async () => {
    installChromeMock([], () => undefined)
    const here = await call<HighlightRecord>('highlight/create', createReq())
    const elsewhere = await call<HighlightRecord>('highlight/create', createReq('https://example.com/other'))
    await call('anchor/report', { canonicalUrl: PAGE, found: [], lost: [here.id, elsewhere.id] })
    expect(await lostRows()).toEqual([here.id])
    await call('anchor/report', { canonicalUrl: PAGE, found: [here.id], lost: [] })
    expect(await lostRows()).toEqual([])
    // The record itself is untouched: text and comment stay.
    expect(await read.byId(here.id)).toMatchObject({ text: 'quoted text', comment: 'note', deletedAt: null })
  })

  it('anchor/report rejects malformed payloads', async () => {
    installChromeMock([], () => undefined)
    const r = await router.handle({ kind: 'noteit/request', type: 'anchor/report', req: { canonicalUrl: PAGE, found: 1 } }, self)
    expect(r).toMatchObject({ ok: false, error: { code: 'bad_request' } })
  })

  it('jumpTo reuses a same-page tab in the current window and returns flashed', async () => {
    const tabs = [
      { id: 1, url: `${PAGE}#x`, windowId: 2 },
      { id: 2, url: `${PAGE}?utm_source=y`, windowId: 1 },
    ]
    const chromeMock = installChromeMock(tabs, () => ({ ok: true, data: { found: true } }))
    const rec = await call<HighlightRecord>('highlight/create', createReq())
    await call('anchor/report', { canonicalUrl: PAGE, found: [], lost: [rec.id] })
    expect(await call('nav/jumpTo', { id: rec.id })).toEqual({ result: 'flashed' })
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(2, { active: true })
    expect(chromeMock.windows.update).not.toHaveBeenCalled()
    expect(chromeMock.tabs.create).not.toHaveBeenCalled()
    expect(await lostRows()).toEqual([])
  })

  it('jumpTo switches to another window when only that window has the page', async () => {
    const chromeMock = installChromeMock([{ id: 5, url: PAGE, windowId: 3 }], () => ({ ok: true, data: { found: true } }))
    const rec = await call<HighlightRecord>('highlight/create', createReq())
    expect(await call('nav/jumpTo', { id: rec.id })).toEqual({ result: 'flashed' })
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(5, { active: true })
    expect(chromeMock.windows.update).toHaveBeenCalledWith(3, { focused: true })
  })

  it('jumpTo opens a new tab when none matches; not found there writes anchorStatus', async () => {
    const chromeMock = installChromeMock([], () => ({ ok: true, data: { found: false } }))
    const rec = await call<HighlightRecord>('highlight/create', createReq())
    expect(await call('nav/jumpTo', { id: rec.id })).toEqual({ result: 'lost' })
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({ url: PAGE, active: true, windowId: 1 })
    expect(await lostRows()).toEqual([rec.id])
  })

  it('jumpTo returns not_found for deleted records', async () => {
    installChromeMock([], () => undefined)
    const rec = await call<HighlightRecord>('highlight/create', createReq())
    await call('highlight/delete', { id: rec.id })
    const r = await router.handle({ kind: 'noteit/request', type: 'nav/jumpTo', req: { id: rec.id } }, self)
    expect(r).toMatchObject({ ok: false, error: { code: 'not_found' } })
  })
})
