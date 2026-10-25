// Sync status for the shell (Story 3.10, FR37): asked from the service worker (sync/getStatus) and kept
// current through sync/status events. Opening the panel (signed in) triggers push + pull in the service
// worker (Story 2.17); lists re-query on db/changed once remote rows have been merged.
import { useCallback, useEffect, useState } from 'react'
import { createClient, onEvent } from '../../../core/messaging/index.ts'
import type { SyncEvents, SyncRequests, SyncStatus } from '../../../core/sync/protocol.ts'
import { strings } from '../../strings.ts'

export const syncClient = createClient<SyncRequests>()

export interface SyncStatusState {
  /** null until the first answer. */
  status: SyncStatus | null
  retrying: boolean
  /** Resets the backoff and pushes now. */
  retry: () => Promise<void>
}

export function useSyncStatus(): SyncStatusState {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    let active = true
    const unsubscribe = onEvent<SyncEvents>({
      'sync/status': (next) => setStatus(next),
    })
    void syncClient.send('sync/getStatus', undefined).then((result) => {
      if (active && result.ok) setStatus(result.data)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const retry = useCallback(async () => {
    setRetrying(true)
    const result = await syncClient.send('sync/retry', undefined)
    setRetrying(false)
    if (result.ok) setStatus(result.data)
  }, [])

  return { status, retrying, retry }
}

/** Tells the service worker the panel opened, so it pushes and pulls now. */
export function useSidebarOpened(): void {
  useEffect(() => {
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      const result = await syncClient.send('sidebar/opened', tab?.id === undefined ? {} : { tabId: tab.id })
      if (!result.ok) console.warn('[NoteIt] sidebar/opened failed:', result.error.code)
    })()
  }, [])
}

/** Spoken / labelled description of the current state. */
export function syncDescription(status: SyncStatus | null): string {
  if (!status) return strings.syncSynced
  const parts: string[] = []
  if (status.pending > 0) parts.push(strings.syncPending(status.pending))
  if (status.state === 'error') parts.push(strings.syncFailedState)
  return parts.length > 0 ? parts.join(strings.listJoin) : strings.syncSynced
}
