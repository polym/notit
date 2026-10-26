/** @jsxImportSource preact */
// comment-editor (DESIGN.md "Components", EXPERIENCE.md): multi-line input inside an overlay, with a
// footer holding an optional leading control, the save chord hint and a visible save button.
// Cmd/Ctrl+Enter saves, Esc cancels. Both keys are handled here and stop propagating; other keys
// typed into the editor do not reach the page's bubble listeners either. Page capture listeners are
// kept away from Esc and the save chord by the window capture guard of the overlay that hosts this
// editor (see installFloatingMenuKeyGuard), which re-dispatches them inside the shadow root.
import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { strings } from '../../strings.ts'
import { isSaveChord } from './save-chord.ts'

export interface CommentEditorProps {
  initial?: string
  onSave: (value: string) => void
  onCancel: () => void
  /** Focus the textarea when it mounts (default true). */
  autoFocus?: boolean
  /** Control at the start of the footer (highlight-popover: the delete button). */
  leading?: ComponentChildren
}

/** macOS shows the symbol chord; Windows / Linux show Ctrl+Enter. */
const isMac = (): boolean => /mac/i.test(navigator.platform || navigator.userAgent)

export function CommentEditor({ initial = '', onSave, onCancel, autoFocus = true, leading }: CommentEditorProps) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (isSaveChord(e)) {
      e.preventDefault()
      onSave(value.trim())
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }
  const stop = (e: Event) => e.stopPropagation()

  return (
    <div class="nt-editor">
      <textarea
        ref={ref}
        class="nt-comment-editor"
        rows={2}
        aria-label={strings.commentButton}
        placeholder={strings.commentPlaceholder}
        value={value}
        onInput={(e) => setValue(e.currentTarget.value)}
        onKeyDown={onKeyDown}
        onKeyUp={stop}
        onKeyPress={stop}
      />
      <div class="nt-editor-foot">
        {leading}
        <span class="nt-editor-hint">{isMac() ? strings.commentSaveHint : strings.commentSaveHintCtrl}</span>
        <button type="button" class="nt-save" onClick={() => onSave(value.trim())}>
          {strings.commentSave}
        </button>
      </div>
    </div>
  )
}
