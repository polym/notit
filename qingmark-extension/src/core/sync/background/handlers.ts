// Service worker handlers for sync requests (architecture.md D6).
import type { Handlers } from '../../messaging/index.ts'
import type { SyncRequests } from '../protocol.ts'
import { pullNow, readSyncStatus, retryNow } from './engine.ts'

export const syncHandlers: Handlers<SyncRequests> = {
  async 'sidebar/opened'() {
    // Fire and forget: the side panel re-queries on db/changed once the pull has merged.
    void pullNow()
  },
  async 'sync/getStatus'() {
    return readSyncStatus()
  },
  async 'sync/retry'() {
    return retryNow()
  },
}
