// Mounts the translate card into the page's Shadow host and runs its lookup (spec "selection
// translation"). One card at a time, registered with the page-wide overlay manager. Closing the
// card cancels a lookup still in flight; an answer for a closed or replaced card is dropped.
import { h, render } from 'preact'
import { createClient } from '../../../core/messaging/index.ts'
import { mountShadowHost, overlayManager, type OverlayRect } from '../../../ui/inpage/index.ts'
import { PRIMITIVES_CSS } from '../../../ui/inpage/primitives/index.ts'
import { MAX_TEXT_LENGTH } from '../shared/classify.ts'
import type { TranslateRequests } from '../shared/protocol.ts'
import { TRANSLATE_CARD_CSS, TranslateCard, type CardState } from './TranslateCard.tsx'
import { noEnglishVoice, speak } from './speech.ts'

const client = createClient<TranslateRequests>()

export interface TranslateCardHandlers {
  /** Shown as the card's highlight action when given. */
  onHighlight?: () => void
  /** Pronounces a word; the button shows only when given. */
  onPronounce?: (word: string) => void
  /** True when no English voice is available (the pronounce button is disabled). */
  voiceless?: () => boolean
}

let sheet: CSSStyleSheet | null = null
let open: { container: HTMLElement; overlay: { close(): void }; requestId: string | null } | null = null

function newId(): string {
  return crypto.randomUUID()
}

/** Opens the card next to `anchor` and translates `text` in `context`; replaces an open card. */
export function showTranslateCard(anchor: OverlayRect, text: string, context: string, handlers: TranslateCardHandlers = {}): boolean {
  const shadow = mountShadowHost()
  if (!shadow) return false
  sheet = shadow.adoptStyles(sheet ?? `${PRIMITIVES_CSS}${TRANSLATE_CARD_CSS}`)
  hideTranslateCard()

  const container = document.createElement('div')
  shadow.root.append(container)
  const entry: { container: HTMLElement; overlay: { close(): void }; requestId: string | null } = {
    container,
    requestId: null,
    overlay: {
      close() {
        if (entry.requestId) void client.send('translate/cancel', { requestId: entry.requestId })
        entry.requestId = null
        render(null, container)
        container.remove()
        if (open === entry) open = null
      },
    },
  }
  open = entry
  overlayManager.open(entry.overlay)

  const draw = (state: CardState) => {
    if (open !== entry) return
    render(
      h(TranslateCard, {
        anchor,
        source: text,
        state,
        onRetry: lookup,
        onOpenSettings: () => void client.send('translate/openSettings', undefined),
        onClose: () => overlayManager.close(entry.overlay),
        onHighlight: handlers.onHighlight,
        // Web Speech by default; callers (tests) may inject their own.
        onPronounce: handlers.onPronounce ?? speak,
        voiceless: (handlers.voiceless ?? noEnglishVoice)(),
      }),
      container,
    )
  }

  function lookup() {
    if (text.length > MAX_TEXT_LENGTH) {
      draw({ kind: 'tooLong' })
      return
    }
    const requestId = newId()
    entry.requestId = requestId
    draw({ kind: 'loading' })
    void client.send('translate/lookup', { requestId, text, context }).then((result) => {
      // Closed, replaced or retried meanwhile: this answer belongs to nobody.
      if (open !== entry || entry.requestId !== requestId) return
      entry.requestId = null
      draw(result.ok ? { kind: 'result', result: result.data } : { kind: 'error', code: result.error.code })
    })
  }

  lookup()
  return true
}

export function hideTranslateCard(): void {
  if (open) overlayManager.close(open.overlay)
}

export function isTranslateCardOpen(): boolean {
  return open !== null
}

/** True when the event happened inside the open card (events from the Shadow root are retargeted). */
export function isInsideTranslateCard(event: Event): boolean {
  return open !== null && event.composedPath().includes(open.container)
}
