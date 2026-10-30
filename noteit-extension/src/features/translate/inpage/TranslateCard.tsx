/** @jsxImportSource preact */
// translate-card (spec "selection translation"): opened from the floating menu's translate button.
// Placed below the selection (flipped above without room). States: loading, word (lemma, IPA,
// part of speech, in-context sense, other senses), text (translation), error (retry, or open the
// settings when nothing is configured). The body is a polite live region so results are announced.
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { ErrorCode } from '../../../core/messaging/index.ts'
import { strings, translateErrorText } from '../../../ui/strings.ts'
import { placeOverlay, type OverlayRect } from '../../../ui/inpage/index.ts'
import { IconButton, SpeakerIcon } from '../../../ui/inpage/primitives/index.ts'
import type { TranslateResult } from '../shared/protocol.ts'

export type CardState =
  | { kind: 'loading' }
  | { kind: 'result'; result: TranslateResult }
  | { kind: 'error'; code: ErrorCode }
  | { kind: 'tooLong' }

export interface TranslateCardProps {
  anchor: OverlayRect
  /** The selected text, shown as the card title (truncated by CSS). */
  source: string
  state: CardState
  onRetry: () => void
  onOpenSettings: () => void
  onClose: () => void
  /** Shown only when given (highlighting needs a session). */
  onHighlight?: () => void
  /** Shown only for a word result when given; `voiceless` disables it with a reason. */
  onPronounce?: (word: string) => void
  voiceless?: boolean
}

export type TranslateBodyProps = Pick<TranslateCardProps, 'state' | 'onRetry' | 'onOpenSettings' | 'onPronounce' | 'voiceless'>

/** Card body by state; also the body of the floating menu's translate section (TranslatePanel). */
export function Body({ state, onRetry, onOpenSettings, onPronounce, voiceless }: TranslateBodyProps) {
  if (state.kind === 'loading') return <p class="nt-tr-muted">{strings.translateLoading}</p>
  if (state.kind === 'tooLong') return <p class="nt-tr-error">{strings.translateTooLong}</p>
  if (state.kind === 'error') {
    const settings = state.code === 'not_configured' || state.code === 'unauthenticated'
    return (
      <div class="nt-tr-error-box">
        <p class="nt-tr-error">{translateErrorText(state.code)}</p>
        <button type="button" class="nt-tr-action" data-noteit-translate-action={settings ? 'settings' : 'retry'} onClick={settings ? onOpenSettings : onRetry}>
          {settings ? strings.translateOpenSettings : strings.translateRetry}
        </button>
      </div>
    )
  }
  const { result } = state
  if (result.mode === 'text') return <p class="nt-tr-sense" data-noteit-translation="">{result.translation}</p>
  const { us, uk } = result.ipa
  return (
    <div class="nt-tr-word">
      <div class="nt-tr-head">
        <span class="nt-tr-lemma" data-noteit-lemma="">
          {result.lemma}
        </span>
        {result.pos && <span class="nt-tr-pos">{result.pos}</span>}
        {onPronounce && (
          <span title={voiceless ? strings.translateNoVoice : undefined}>
            <button
              type="button"
              class="nt-round nt-round-soft nt-tr-speak"
              aria-label={voiceless ? strings.translatePronounceUnavailable : strings.translatePronounce}
              disabled={voiceless}
              onClick={() => onPronounce(result.lemma)}
            >
              <SpeakerIcon />
            </button>
          </span>
        )}
      </div>
      {(us || uk) && (
        <p class="nt-tr-ipa" data-noteit-ipa="">
          {us && <span>{`${strings.translateIpaUs} /${us}/`}</span>}
          {uk && <span>{`${strings.translateIpaUk} /${uk}/`}</span>}
        </p>
      )}
      <p class="nt-tr-sense" data-noteit-sense="">
        {result.sense}
      </p>
      {result.otherSenses.length > 0 && (
        <p class="nt-tr-muted" data-noteit-other-senses="">
          {strings.translateOtherSensesLine(result.otherSenses.join(strings.listJoin))}
        </p>
      )}
    </div>
  )
}

export function TranslateCard(props: TranslateCardProps) {
  const { anchor, source, state, onClose, onHighlight } = props
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Re-placed on every state change: the result is taller than the loading line.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const p = placeOverlay(anchor, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, 'below')
    setPosition({ left: p.left, top: p.top })
  }, [anchor, state])

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div
      ref={ref}
      class="nt-overlay nt-card nt-translate-card"
      data-noteit-translate=""
      data-noteit-translate-state={state.kind === 'result' ? state.result.mode : state.kind}
      role="dialog"
      aria-label={strings.translateCardLabel}
      style={{ left: `${position?.left ?? 0}px`, top: `${position?.top ?? 0}px`, visibility: position ? 'visible' : 'hidden' }}
      onKeyDown={onKeyDown}
      // Keep the page selection: the highlight action creates it from the selected range.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div class="nt-tr-top">
        <p class="nt-tr-source">{source}</p>
        <IconButton label={strings.close} onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </IconButton>
      </div>
      <div class="nt-tr-body" aria-live="polite" aria-busy={state.kind === 'loading'}>
        <Body {...props} />
      </div>
      {onHighlight && state.kind === 'result' && (
        <div class="nt-tr-foot">
          <button type="button" class="nt-tr-action" onClick={onHighlight}>
            {strings.translateHighlight}
          </button>
        </div>
      )}
    </div>
  )
}

/** Component CSS of the translate card (on top of the shared primitives). */
export const TRANSLATE_CARD_CSS = `
.nt-translate-card {
  width: 320px;
  max-width: calc(100vw - 16px);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.nt-translate-card p { margin: 0; }
.nt-tr-top { display: flex; align-items: center; gap: 8px; }
.nt-tr-source {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--nt-subtle-foreground);
  font-size: var(--nt-meta-font-size);
}
.nt-tr-head { display: flex; align-items: center; gap: 8px; }
.nt-tr-lemma { font-size: 16px; font-weight: 600; color: var(--nt-foreground); }
.nt-tr-pos { color: var(--nt-subtle-foreground); font-size: var(--nt-meta-font-size); }
.nt-tr-ipa { display: flex; gap: 12px; color: var(--nt-subtle-foreground); font-size: var(--nt-meta-font-size); }
.nt-tr-word { display: flex; flex-direction: column; gap: 6px; }
.nt-tr-sense { color: var(--nt-foreground); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 240px; overflow: auto; }
.nt-tr-muted { color: var(--nt-subtle-foreground); font-size: var(--nt-meta-font-size); }
.nt-tr-error { color: var(--nt-foreground); }
.nt-tr-error-box { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.nt-tr-foot { display: flex; justify-content: flex-end; }
.nt-tr-speak[disabled] { opacity: 0.5; cursor: not-allowed; }
.nt-tr-action {
  all: unset;
  box-sizing: border-box;
  height: 28px;
  padding: 0 12px;
  border-radius: var(--nt-radius-full);
  background: var(--nt-canvas);
  color: var(--nt-foreground);
  font-family: var(--nt-font-family);
  font-size: var(--nt-meta-font-size);
  line-height: 28px;
  cursor: pointer;
}
.nt-tr-action:hover { background: var(--nt-hover); }
.nt-tr-action:focus-visible, .nt-tr-speak:focus-visible { outline: 2px solid var(--nt-ring); outline-offset: 2px; }
`
