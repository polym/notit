// highlight-item / highlight-item-lost (DESIGN.md "Components", Story 3.5, FR13 display): 3px solid
// color bar, text clamped to two lines, comment below in meta type. A lost item keeps its full text
// and comment, turns muted, dims the bar to 0.35 and adds the "not found" caption.
// Story 3.8 (FR6, FR7, Q59): on hover or keyboard focus the row floats a floating-menu style bar at
// top 4px / right 6px with 4 color dots (current one ringed), a separator, and the comment and delete
// icon buttons; the text column then keeps 136px clear on its right. The comment button opens an
// inline comment-editor (Cmd/Ctrl+Enter saves, Esc cancels). Writes wait for db/changed.
import { useRef, useState, type KeyboardEvent } from 'react'
import type { ColorName, HighlightRecord } from '../../../core/model/index.ts'
import { COLOR_ORDER, colorLabel, solidColorVar } from '../../../ui/palette.ts'
import { effects } from '../../../ui/tokens/index.ts'
import { strings } from '../../../ui/strings.ts'
import type { ItemActions } from './actions.ts'

const META = {
  fontSize: 'var(--nt-meta-font-size)',
  lineHeight: 'var(--nt-meta-line-height)',
  fontWeight: 'var(--nt-meta-font-weight)',
} as const

const ICON_BUTTON =
  'flex shrink-0 items-center justify-center rounded bg-transparent hover:bg-selected focus-visible:bg-selected focus-visible:outline-2 focus-visible:outline-ring'

function CommentIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
    </svg>
  )
}

/**
 * color-dot: 12px solid dot in a 22px hit area; the current color gets the selected fill and ring.
 * The in-page twin is ui/inpage/primitives/ColorDot.tsx (Preact); the lint import zones keep React and
 * Preact apart, so the two components share ui/palette.ts and tokens/effects.ts instead of code.
 */
function ColorDot({ color, selected, onSelect }: { color: ColorName; selected: boolean; onSelect: () => void }) {
  const label = colorLabel(color)
  return (
    <button
      type="button"
      data-testid="color-dot"
      data-color={color}
      aria-label={label}
      aria-pressed={selected}
      title={label}
      onClick={onSelect}
      className={`${ICON_BUTTON} ${selected ? 'bg-selected' : ''}`}
      style={{ width: '22px', height: '22px' }}
    >
      <span
        aria-hidden="true"
        className="block"
        style={{
          width: '12px',
          height: '12px',
          boxSizing: 'border-box',
          border: effects.colorDotBorder,
          borderRadius: 'var(--nt-radius-full)',
          background: solidColorVar(color),
          boxShadow: selected ? effects.colorDotSelectedRing : undefined,
        }}
      />
    </button>
  )
}

/** comment-editor: multi-line input expanded inside the row; Cmd/Ctrl+Enter saves, Esc cancels. */
function CommentEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string
  onSave: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Let the IME handle keystrokes during composition (e.g. Esc dismisses Pinyin candidates).
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      onSave(value)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
  }
  return (
    <div className="mt-1 flex flex-col" style={{ gap: 'var(--nt-space-1)' }}>
      <textarea
        data-testid="comment-editor"
        aria-label={initial ? strings.commentEdit : strings.commentAdd}
        placeholder={strings.commentPlaceholder}
        // The editor opens on an explicit click, so moving focus into it is expected.
        autoFocus
        rows={2}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        className="w-full resize-y rounded border border-border-strong bg-background text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        style={{
          padding: 'var(--nt-space-1) var(--nt-space-1-5)',
          fontSize: 'var(--nt-body-font-size)',
          lineHeight: 'var(--nt-body-line-height)',
        }}
      />
      <div className="flex justify-end" style={{ gap: 'var(--nt-space-1)', ...META }}>
        <button type="button" onClick={onCancel} className="rounded bg-transparent px-2 text-muted-foreground hover:bg-selected focus-visible:outline-2 focus-visible:outline-ring">
          {strings.commentCancel}
        </button>
        <button type="button" onClick={() => onSave(value)} className="rounded bg-primary px-2 text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring">
          {strings.commentSave}
        </button>
      </div>
    </div>
  )
}

export function HighlightItem({
  highlight: h,
  lost,
  actions,
}: {
  highlight: HighlightRecord
  lost: boolean
  actions: ItemActions
}) {
  const [editing, setEditing] = useState(false)
  const commentButtonRef = useRef<HTMLButtonElement>(null)
  // Story 3.11: closing the editor hands focus back to the comment button, so keyboard users keep
  // their place in the row instead of dropping to <body>.
  const closeEditor = () => {
    setEditing(false)
    commentButtonRef.current?.focus()
  }
  const textColor = lost ? 'text-muted-foreground' : 'text-foreground'
  const save = (value: string) => {
    // Unchanged text just closes the editor; otherwise close once the write succeeded.
    if (value.trim() === (h.comment ?? '')) {
      closeEditor()
      return
    }
    void actions.onSaveComment(h.id, value).then((ok) => {
      if (ok) closeEditor()
    })
  }
  return (
    <li
      data-testid="highlight-item"
      data-highlight-item-id={h.id}
      data-lost={lost ? 'true' : undefined}
      data-color={h.color}
      className="group relative flex border-b border-muted hover:bg-hover focus-within:bg-hover"
      style={{ gap: 'var(--nt-space-2)', padding: 'var(--nt-space-row-y) var(--nt-space-row-x)', borderRadius: 'var(--nt-radius)' }}
    >
      <span
        role="img"
        aria-label={colorLabel(h.color)}
        title={colorLabel(h.color)}
        data-testid="color-bar"
        className="shrink-0 self-stretch"
        style={{
          width: 'var(--nt-space-color-bar)',
          borderRadius: 'var(--nt-radius-xs)',
          background: solidColorVar(h.color),
          opacity: lost ? 0.35 : 1,
        }}
      />
      {/* hover-text-padding-right: 136px while the actions bar is shown. */}
      <div data-testid="highlight-body" className="min-w-0 flex-1 group-hover:pr-[136px] group-focus-within:pr-[136px]">
        {/* Lost items do not jump (EXPERIENCE assumption, epics proxy decision). */}
        <button
          type="button"
          disabled={lost}
          onClick={() => actions.onJumpTo(h.id)}
          className={`block w-full bg-transparent p-0 text-left ${textColor} ${lost ? 'cursor-default' : 'cursor-pointer'} focus-visible:outline-2 focus-visible:outline-ring`}
          style={{ fontSize: 'var(--nt-body-font-size)', lineHeight: 'var(--nt-body-line-height)', fontWeight: 'var(--nt-body-font-weight)' }}
        >
          <span data-testid="highlight-text" className="line-clamp-2 break-words">
            {h.text}
          </span>
        </button>
        {h.comment && !editing && (
          <div data-testid="highlight-comment" className="mt-0.5 flex items-start gap-1 text-muted-foreground" style={META}>
            <span aria-hidden="true" className="mt-0.5 flex shrink-0">
              <CommentIcon />
            </span>
            <span className="min-w-0 break-words whitespace-pre-wrap">{h.comment}</span>
          </div>
        )}
        {editing && <CommentEditor initial={h.comment ?? ''} onSave={save} onCancel={closeEditor} />}
        {lost && (
          <div
            data-testid="anchor-lost"
            className="mt-0.5 text-muted-foreground"
            style={{ fontSize: 'var(--nt-caption-font-size)', lineHeight: 'var(--nt-caption-line-height)' }}
          >
            {strings.anchorLost}
          </div>
        )}
      </div>
      {/* Invisible until the row is hovered or holds focus; still reachable with Tab. */}
      <div
        data-testid="item-actions"
        className="absolute flex items-center border border-border-strong bg-background opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
        style={{ top: '4px', right: '6px', padding: '1px', gap: 'var(--nt-space-0-5)', borderRadius: 'var(--nt-radius-md)' }}
      >
        {COLOR_ORDER.map((color) => (
          <ColorDot
            key={color}
            color={color}
            selected={color === h.color}
            onSelect={() => {
              if (color !== h.color) actions.onSetColor(h.id, color)
            }}
          />
        ))}
        <span aria-hidden="true" className="bg-border" style={{ width: '1px', height: '14px', margin: '0 3px' }} />
        <button
          type="button"
          ref={commentButtonRef}
          data-testid="item-comment"
          onClick={() => setEditing((v) => !v)}
          aria-expanded={editing}
          title={h.comment ? strings.commentEdit : strings.commentAdd}
          aria-label={h.comment ? strings.commentEdit : strings.commentAdd}
          className={`${ICON_BUTTON} text-muted-foreground`}
          style={{ width: '22px', height: '22px' }}
        >
          <CommentIcon size={14} />
        </button>
        {/* Quiet delete color: undo is the safety net, not a red button (DESIGN.md). */}
        <button
          type="button"
          data-testid="item-delete"
          onClick={() => actions.onDelete(h.id)}
          title={strings.deleteHighlight}
          aria-label={strings.deleteHighlight}
          className={`${ICON_BUTTON} text-subtle-foreground`}
          style={{ width: '22px', height: '22px' }}
        >
          <TrashIcon />
        </button>
      </div>
    </li>
  )
}
