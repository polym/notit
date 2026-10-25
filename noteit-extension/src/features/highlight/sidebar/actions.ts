// Side panel item actions shared by the current page and all-sites views. Every write goes to the
// service worker (single writer, architecture.md D4 / D12); lists update on db/changed, never
// optimistically (Story 3.8).
import type { ColorName } from '../../../core/model/index.ts'
import { client } from './client.ts'
import type { HighlightPatch } from '../shared/protocol.ts'

// Jump through the service worker (Q55): it picks or opens the tab, flashes the highlight and writes
// anchorStatus when the highlight cannot be shown.
export const jumpTo = async (id: string): Promise<void> => {
  const result = await client.send('nav/jumpTo', { id })
  if (!result.ok) console.warn('[NoteIt] nav/jumpTo failed:', result.error.code)
}

/** Soft delete through the service worker; true when the record was deleted. */
export const remove = async (id: string): Promise<boolean> => {
  const result = await client.send('highlight/delete', { id })
  if (!result.ok) console.warn('[NoteIt] highlight/delete failed:', result.error.code)
  return result.ok
}

/** Clears the soft delete (undo); the record is re-stamped by the service worker. */
export const restore = async (id: string): Promise<boolean> => {
  const result = await client.send('highlight/restore', { id })
  if (!result.ok) console.warn('[NoteIt] highlight/restore failed:', result.error.code)
  return result.ok
}

const update = async (id: string, patch: HighlightPatch): Promise<boolean> => {
  const result = await client.send('highlight/update', { id, patch })
  if (!result.ok) console.warn('[NoteIt] highlight/update failed:', result.error.code)
  return result.ok
}

export const setColor = (id: string, color: ColorName): Promise<boolean> => update(id, { color })

/** Writes only the comment, so the color is left as it is. Blank text clears the comment. */
export const setComment = (id: string, comment: string): Promise<boolean> => {
  const trimmed = comment.trim()
  return update(id, { comment: trimmed === '' ? null : trimmed })
}

/** Item callbacks passed from a view down to every HighlightItem. */
export interface ItemActions {
  onJumpTo: (id: string) => void
  onDelete: (id: string) => void
  onSetColor: (id: string, color: ColorName) => void
  onSaveComment: (id: string, comment: string) => Promise<boolean>
}
