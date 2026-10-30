import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '../../../core/db/schema.ts'
import { STORAGE_KEYS, setSiteOverride } from '../../../core/settings/index.ts'
import { strings } from '../../../ui/strings.ts'
import { HIGHLIGHT_MENU_ID, LOGIN_NEEDED_BADGE, addMenu, createMenus, onCommand, onMenuClicked, triggerHighlight } from './commands.ts'
import { setCachedSignedIn, setSignedInSource } from './auth-gate.ts'

function installChromeMock() {
  const store = new Map<string, unknown>()
  const chromeMock = {
    runtime: { id: 'noteit-test-id', sendMessage: vi.fn(async () => undefined) },
    tabs: {
      sendMessage: vi.fn(async (): Promise<unknown> => ({ ok: true, data: { id: 'x' } })),
      query: vi.fn(async () => [] as { id?: number; url?: string }[]),
    },
    contextMenus: { create: vi.fn(), removeAll: vi.fn((done?: () => void) => done?.()) },
    i18n: { getMessage: vi.fn((key: string) => (key === 'menuHighlightSelection' ? strings.menuHighlightSelection : '')) },
    sidePanel: { open: vi.fn<(options: { windowId?: number; tabId?: number }) => Promise<void>>(async () => {}) },
    action: { setBadgeText: vi.fn<(details: { text: string; tabId?: number }) => Promise<void>>(async () => {}) },
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
  return { chromeMock, store }
}

const TRIGGER = { kind: 'noteit/request', type: 'page/triggerHighlight', req: { color: 'yellow' } }

describe('shortcut and context menu commands', () => {
  let mock: ReturnType<typeof installChromeMock>
  beforeEach(async () => {
    mock = installChromeMock()
    setSignedInSource(async () => true)
    setCachedSignedIn(true)
    const db = getDb()
    await Promise.all(db.tables.map((t) => t.clear()))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('turns a closed site on, then sends page/triggerHighlight {color:yellow} to the tab', async () => {
    await setSiteOverride('example.com', 'off')
    const result = await triggerHighlight({ id: 7, url: 'https://www.example.com/a' })
    expect(result).toEqual({ ok: true, data: { id: 'x' } })
    expect(mock.store.get(STORAGE_KEYS.siteOverrides)).toEqual({ 'example.com': 'on' })
    expect(mock.chromeMock.tabs.sendMessage).toHaveBeenCalledWith(7, TRIGGER)
  })

  it('broadcasts site/changed when it turns a site on, and not when the site was already on', async () => {
    const SITE_ON = { kind: 'noteit/event', type: 'site/changed', payload: { siteKey: 'example.com', enabled: true } }
    mock.chromeMock.tabs.sendMessage.mockResolvedValueOnce({ ok: false, error: { code: 'bad_request', message: 'no text selected' } })
    await triggerHighlight({ id: 7, url: 'https://example.com/a' })
    await vi.waitFor(() => expect(mock.chromeMock.runtime.sendMessage).toHaveBeenCalledWith(SITE_ON))

    mock.chromeMock.runtime.sendMessage.mockClear()
    await triggerHighlight({ id: 7, url: 'https://example.com/a' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mock.chromeMock.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('ignores non-http tabs and tabs without id', async () => {
    expect(await triggerHighlight({ id: 1, url: 'chrome://extensions' })).toBeNull()
    expect(await triggerHighlight({ url: 'https://example.com' })).toBeNull()
    expect(await triggerHighlight(undefined)).toBeNull()
    expect(mock.chromeMock.tabs.sendMessage).not.toHaveBeenCalled()
  })

  it('a tab without a content script yields an error Result, not a rejection', async () => {
    mock.chromeMock.tabs.sendMessage.mockRejectedValueOnce(new Error('Receiving end does not exist'))
    const result = await triggerHighlight({ id: 3, url: 'https://example.com/a' })
    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('the shortcut command and the highlight menu item both trigger', async () => {
    onCommand('highlight-selection', { id: 4, url: 'https://example.com/a' })
    onMenuClicked({ menuItemId: HIGHLIGHT_MENU_ID }, { id: 5, url: 'https://example.com/b' })
    onCommand('other-command', { id: 6, url: 'https://example.com/c' })
    await vi.waitFor(() => expect(mock.chromeMock.tabs.sendMessage).toHaveBeenCalledTimes(2))
    expect(mock.chromeMock.tabs.sendMessage).toHaveBeenCalledWith(4, TRIGGER)
    expect(mock.chromeMock.tabs.sendMessage).toHaveBeenCalledWith(5, TRIGGER)
  })

  it.each([
    ['shortcut', () => onCommand('highlight-selection', { id: 4, windowId: 9, url: 'https://example.com/a' })],
    ['menu', () => onMenuClicked({ menuItemId: HIGHLIGHT_MENU_ID }, { id: 4, windowId: 9, url: 'https://example.com/a' })],
  ])('signed out, the %s opens the side panel synchronously and creates nothing', async (_name, run) => {
    setSignedInSource(async () => false)
    setCachedSignedIn(false)
    run()
    // Called inside the listener itself, so the user gesture is still active.
    expect(mock.chromeMock.sidePanel.open).toHaveBeenCalledWith({ windowId: 9 })
    await new Promise((r) => setTimeout(r, 10))
    expect(mock.chromeMock.tabs.sendMessage).not.toHaveBeenCalled()
    expect(mock.store.has(STORAGE_KEYS.siteOverrides)).toBe(false)
    expect(mock.chromeMock.action.setBadgeText).not.toHaveBeenCalled()
  })

  it('signed out, a throwing or rejecting sidePanel.open shows the ! badge on the tab', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setCachedSignedIn(false)
    mock.chromeMock.sidePanel.open.mockImplementationOnce(() => {
      throw new Error('may only be called in response to a user gesture')
    })
    onCommand('highlight-selection', { id: 4, windowId: 9, url: 'https://example.com/a' })
    expect(mock.chromeMock.action.setBadgeText).toHaveBeenCalledWith({ text: LOGIN_NEEDED_BADGE, tabId: 4 })

    mock.chromeMock.sidePanel.open.mockRejectedValueOnce(new Error('no window'))
    onMenuClicked({ menuItemId: HIGHLIGHT_MENU_ID }, { id: 5, windowId: 9, url: 'https://example.com/b' })
    await vi.waitFor(() =>
      expect(mock.chromeMock.action.setBadgeText).toHaveBeenCalledWith({ text: LOGIN_NEEDED_BADGE, tabId: 5 }),
    )
    expect(mock.chromeMock.tabs.sendMessage).not.toHaveBeenCalled()
  })

  it.each([
    ['shortcut', () => onCommand('highlight-selection', { id: 4, windowId: 9, url: 'https://example.com/a' })],
    ['menu', () => onMenuClicked({ menuItemId: HIGHLIGHT_MENU_ID }, { id: 4, windowId: 9, url: 'https://example.com/a' })],
  ])('cold worker (cache unknown), signed out: the %s opens the side panel synchronously, no !', async (_name, run) => {
    setSignedInSource(async () => false)
    setCachedSignedIn(null)
    run()
    // Opened inside the listener, before the sign-in read resolves.
    expect(mock.chromeMock.sidePanel.open).toHaveBeenCalledWith({ windowId: 9 })
    await new Promise((r) => setTimeout(r, 10))
    expect(mock.chromeMock.sidePanel.open).toHaveBeenCalledTimes(1)
    expect(mock.chromeMock.tabs.sendMessage).not.toHaveBeenCalled()
    expect(mock.store.has(STORAGE_KEYS.siteOverrides)).toBe(false)
    expect(mock.chromeMock.action.setBadgeText).not.toHaveBeenCalled()
  })

  it('cold worker (cache unknown), signed in: opens the panel synchronously and still creates', async () => {
    setSignedInSource(async () => true)
    setCachedSignedIn(null)
    onCommand('highlight-selection', { id: 4, windowId: 9, url: 'https://example.com/a' })
    expect(mock.chromeMock.sidePanel.open).toHaveBeenCalledWith({ windowId: 9 })
    await vi.waitFor(() => expect(mock.chromeMock.tabs.sendMessage).toHaveBeenCalledWith(4, TRIGGER))
  })

  it('a stale signed-in cache falls back to the side panel when the create is unauthenticated', async () => {
    mock.chromeMock.tabs.sendMessage.mockResolvedValueOnce({
      ok: false,
      error: { code: 'unauthenticated', message: 'signed out' },
    } as never)
    onCommand('highlight-selection', { id: 4, windowId: 9, url: 'https://example.com/a' })
    await vi.waitFor(() => expect(mock.chromeMock.sidePanel.open).toHaveBeenCalledWith({ windowId: 9 }))
  })

  it('registers exactly one context menu item: the selection highlight, titled from _locales', () => {
    createMenus()
    expect(mock.chromeMock.i18n.getMessage).toHaveBeenCalledWith('menuHighlightSelection')
    expect(mock.chromeMock.contextMenus.create).toHaveBeenCalledTimes(1)
    expect(mock.chromeMock.contextMenus.create).toHaveBeenCalledWith({
      id: HIGHLIGHT_MENU_ID,
      title: strings.menuHighlightSelection,
      contexts: ['selection'],
    })
  })

  it('has no site toggle item and ignores clicks on unknown menu ids', () => {
    createMenus()
    const items = mock.chromeMock.contextMenus.create.mock.calls.map((call) => (call as unknown[])[0])
    expect(items.some((item) => (item as { contexts?: string[] }).contexts?.includes('page'))).toBe(false)
    onMenuClicked({ menuItemId: 'noteit-toggle' }, { id: 4, windowId: 9, url: 'https://example.com/a' })
    expect(mock.chromeMock.tabs.sendMessage).not.toHaveBeenCalled()
  })

  it('falls back to the UI strings title when the locale message is missing', () => {
    mock.chromeMock.i18n.getMessage.mockReturnValueOnce('')
    createMenus()
    expect(mock.chromeMock.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: strings.menuHighlightSelection }),
    )
  })

  // Last in this file: addMenu keeps module state, which would change the item count above.
  it("creates other features' items inside the same removeAll callback, after its own", () => {
    const order: string[] = []
    mock.chromeMock.contextMenus.create.mockImplementation((item: { id: string }) => void order.push(item.id))
    addMenu(() => chrome.contextMenus.create({ id: 'other-feature', title: 't', contexts: ['selection'] }))
    createMenus()
    expect(mock.chromeMock.contextMenus.removeAll).toHaveBeenCalledTimes(1)
    expect(order).toEqual([HIGHLIGHT_MENU_ID, 'other-feature'])
  })
})
