// Delete with a 5 second undo window (Story 3.8, Q57, Q60). Delete applies at once; the toast shows
// only in the side panel. Undo clears the soft delete, which reaches every tab through page/sync; after
// the window the record simply stays soft-deleted. A newer delete replaces the pending one.
import { useCallback, useEffect, useRef, useState } from 'react'
import { remove, restore } from './actions.ts'

export const UNDO_WINDOW_MS = 5000

export interface UndoDelete {
  /** Id of the deleted highlight the toast offers to restore, or null when no toast is shown. */
  pendingId: string | null
  deleteWithUndo: (id: string) => void
  undo: () => void
}

export function useUndoDelete(): UndoDelete {
  const [pendingId, setPendingId] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }

  useEffect(() => clearTimer, [])

  const deleteWithUndo = useCallback((id: string) => {
    void remove(id).then((ok) => {
      if (!ok) return
      clearTimer()
      setPendingId(id)
      timer.current = setTimeout(() => {
        timer.current = null
        setPendingId(null)
      }, UNDO_WINDOW_MS)
    })
  }, [])

  const undo = useCallback(() => {
    if (pendingId === null) return
    clearTimer()
    setPendingId(null)
    void restore(pendingId)
  }, [pendingId])

  return { pendingId, deleteWithUndo, undo }
}
