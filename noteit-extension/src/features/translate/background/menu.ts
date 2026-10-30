// Context menu entry "translate with NoteIt" (spec "selection translation"). Works signed out and on
// sites that are off: it only asks the tab's content script to translate its selection.
import { createClient } from '../../../core/messaging/index.ts'
import { strings } from '../../../ui/strings.ts'
import type { TranslatePageRequests } from '../shared/protocol.ts'

export const TRANSLATE_MENU_ID = 'noteit-translate'
/** _locales key of the menu title (must equal strings.menuTranslateSelection). */
export const TRANSLATE_MENU_MESSAGE = 'menuTranslateSelection'

const pageClient = createClient<TranslatePageRequests>()

export function createTranslateMenu(): void {
  const title = chrome.i18n.getMessage(TRANSLATE_MENU_MESSAGE) || strings.menuTranslateSelection
  chrome.contextMenus.create({ id: TRANSLATE_MENU_ID, title, contexts: ['selection'] })
}

export function onTranslateMenuClicked(info: { menuItemId: string | number }, tab: { id?: number } | undefined): void {
  if (info.menuItemId !== TRANSLATE_MENU_ID || tab?.id === undefined) return
  void pageClient.send('page/translateSelection', undefined, { tabId: tab.id }).then((result) => {
    if (!result.ok) console.warn('[NoteIt] translate from the context menu failed:', result.error.code)
  })
}

export function registerTranslateMenu(): void {
  chrome.contextMenus.onClicked.addListener(onTranslateMenuClicked)
}
