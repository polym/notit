// Builds the floating menu's translate section (spec "selection translation"). The highlight
// feature does not import translate: the content script passes this renderer to the menu, which
// calls it while its translate toggle is on.
import { h, type ComponentChildren } from 'preact'
import { mountShadowHost } from '../../../ui/inpage/index.ts'
import { TRANSLATE_CARD_CSS } from './TranslateCard.tsx'
import { TRANSLATE_PANEL_CSS, TranslatePanel } from './TranslatePanel.tsx'
import { selectionContext } from './context.ts'

let sheet: CSSStyleSheet | null = null

/** Render function for the section of `text` selected in `range`; null when there is no host. */
export function translatePanelRenderer(range: Range, text: string): ((onResult: (insertable: string | null) => void) => ComponentChildren) | null {
  const shadow = mountShadowHost()
  if (!shadow) return null
  sheet = shadow.adoptStyles(sheet ?? `${TRANSLATE_CARD_CSS}${TRANSLATE_PANEL_CSS}`)
  // Read from the page once, when the section first opens (the range may be gone later).
  let context: string | null = null
  return (onResult) => {
    context ??= selectionContext(range, text)
    return h(TranslatePanel, { text, context, onResult })
  }
}
