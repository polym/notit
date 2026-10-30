/** @jsxImportSource preact */
// translate-panel (spec "selection translation"): the translate section inside the floating menu,
// shown below the menu's button row while its translate toggle is on. It runs its own lookup on
// mount; unmounting (toggle off, menu closed) cancels a lookup still in flight and drops its answer.
// The body is a polite live region so results are announced.
import { useEffect, useRef, useState } from 'preact/hooks'
import { createClient } from '../../../core/messaging/index.ts'
import { MAX_TEXT_LENGTH } from '../shared/classify.ts'
import type { TranslateRequests } from '../shared/protocol.ts'
import { insertableText } from './insertable.ts'
import { Body, type CardState } from './TranslateCard.tsx'
import { noEnglishVoice, speak } from './speech.ts'

const client = createClient<TranslateRequests>()

export interface TranslatePanelProps {
  text: string
  context: string
  /** Called with the text a comment can take over (null until there is a result). */
  onResult?: (insertable: string | null) => void
  /** Pronounces a word; Web Speech by default. */
  onPronounce?: (word: string) => void
  voiceless?: boolean
}

export function TranslatePanel({ text, context, onResult, onPronounce = speak, voiceless = noEnglishVoice() }: TranslatePanelProps) {
  const [state, setState] = useState<CardState>({ kind: 'loading' })
  const current = useRef<string | null>(null)
  const report = useRef(onResult)
  report.current = onResult

  const lookup = () => {
    if (current.current) void client.send('translate/cancel', { requestId: current.current })
    report.current?.(null)
    if (text.length > MAX_TEXT_LENGTH) {
      current.current = null
      setState({ kind: 'tooLong' })
      return
    }
    const requestId = crypto.randomUUID()
    current.current = requestId
    setState({ kind: 'loading' })
    void client.send('translate/lookup', { requestId, text, context }).then((result) => {
      // Unmounted, retried or replaced meanwhile: this answer belongs to nobody.
      if (current.current !== requestId) return
      current.current = null
      if (result.ok) {
        setState({ kind: 'result', result: result.data })
        report.current?.(insertableText(result.data))
      } else {
        setState({ kind: 'error', code: result.error.code })
      }
    })
  }

  useEffect(() => {
    lookup()
    return () => {
      if (current.current) void client.send('translate/cancel', { requestId: current.current })
      current.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one lookup per text / context
  }, [text, context])

  return (
    <div
      class="nt-tr-panel"
      data-noteit-translate=""
      data-noteit-translate-state={state.kind === 'result' ? state.result.mode : state.kind}
      aria-live="polite"
      aria-busy={state.kind === 'loading'}
    >
      <Body
        state={state}
        onRetry={lookup}
        onOpenSettings={() => void client.send('translate/openSettings', undefined)}
        onPronounce={onPronounce}
        voiceless={voiceless}
      />
    </div>
  )
}

/** Component CSS of the panel, on top of TRANSLATE_CARD_CSS (shared nt-tr-* rules). */
export const TRANSLATE_PANEL_CSS = `
.nt-tr-panel p { margin: 0; }
.nt-tr-panel { min-height: 40px; }
`
