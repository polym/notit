// Context menu "translate with NoteIt" and translate/openSettings (spec "selection translation").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HandlerError } from '../../../core/messaging/index.ts'
import { strings } from '../../../ui/strings.ts'
import { createCache } from './cache.ts'
import { createTranslateHandlers } from './handlers.ts'
import { TRANSLATE_MENU_ID, createTranslateMenu, onTranslateMenuClicked } from './menu.ts'

let chromeMock: {
  runtime: { id: string }
  i18n: { getMessage: ReturnType<typeof vi.fn> }
  contextMenus: { create: ReturnType<typeof vi.fn> }
  tabs: { sendMessage: ReturnType<typeof vi.fn> }
  sidePanel?: { open: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  chromeMock = {
    runtime: { id: 'test' },
    i18n: { getMessage: vi.fn(() => '') },
    contextMenus: { create: vi.fn() },
    tabs: { sendMessage: vi.fn(async () => ({ ok: true, data: { shown: true } })) },
    sidePanel: { open: vi.fn(async () => undefined) },
  }
  vi.stubGlobal('chrome', chromeMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('translate context menu', () => {
  it('creates a selection item titled from _locales, falling back to the UI strings copy', () => {
    createTranslateMenu()
    expect(chromeMock.i18n.getMessage).toHaveBeenCalledWith('menuTranslateSelection')
    expect(chromeMock.contextMenus.create).toHaveBeenCalledWith({
      id: TRANSLATE_MENU_ID,
      title: strings.menuTranslateSelection,
      contexts: ['selection'],
    })
  })

  it('asks the clicked tab to translate its selection and ignores other items', async () => {
    onTranslateMenuClicked({ menuItemId: 'noteit-highlight' }, { id: 7 })
    expect(chromeMock.tabs.sendMessage).not.toHaveBeenCalled()
    onTranslateMenuClicked({ menuItemId: TRANSLATE_MENU_ID }, { id: 7 })
    await vi.waitFor(() => expect(chromeMock.tabs.sendMessage).toHaveBeenCalledTimes(1))
    const [tabId, envelope] = chromeMock.tabs.sendMessage.mock.calls[0] as [number, { type: string }]
    expect(tabId).toBe(7)
    expect(envelope.type).toBe('page/translateSelection')
  })
})

describe('translate/openSettings', () => {
  const handlers = () => createTranslateHandlers({ fetch: vi.fn(), cache: createCache(null) })

  it("opens the side panel of the sender's window", async () => {
    await handlers()['translate/openSettings'](undefined, { tab: { windowId: 3 } } as chrome.runtime.MessageSender)
    expect(chromeMock.sidePanel?.open).toHaveBeenCalledWith({ windowId: 3 })
  })

  it('refuses without a window or without chrome.sidePanel (Arc)', async () => {
    await expect(handlers()['translate/openSettings'](undefined, {} as chrome.runtime.MessageSender)).rejects.toBeInstanceOf(HandlerError)
    delete chromeMock.sidePanel
    await expect(
      handlers()['translate/openSettings'](undefined, { tab: { windowId: 3 } } as chrome.runtime.MessageSender),
    ).rejects.toBeInstanceOf(HandlerError)
  })
})
