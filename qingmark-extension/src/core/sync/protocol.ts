// Message catalogue of core/sync (architecture.md D6). Type-only: safe to import anywhere.
import type { ErrorCode } from '../messaging/types.ts'

/** architecture.md "Sync Algorithm" status. */
export interface SyncStatus {
  state: 'idle' | 'syncing' | 'error'
  /** outbox.count() */
  pending: number
  /** Epoch ms of the last successful push; null before the first one. */
  lastSyncAt: number | null
  /** Reason of the latest failure while the engine is retrying or in error. */
  lastError?: { code: ErrorCode; message: string }
}

export type SyncRequests = {
  /** The side panel opened (or was shown again); the SW pushes, then pulls. Answers immediately. */
  'sidebar/opened': { req: { tabId?: number }; res: void }
  'sync/getStatus': { req: void; res: SyncStatus }
  /** Resets the backoff and pushes now; answers with the status after that push. */
  'sync/retry': { req: void; res: SyncStatus }
}

export type SyncEvents = {
  'sync/status': SyncStatus
}
