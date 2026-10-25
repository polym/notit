// Diagnostics page entry (architecture.md "Diagnostics", Story 2.23): composition only.
// Shows syncStatus (asked from the service worker), the outbox and the newest logs (read-only from
// the local database), and exports the local id list {id, editedAt, deletedAt} as JSON for
// scripts/verify-consistency.ts. Nothing here writes to the database.
import { createClient } from '../../core/messaging/index.ts'
import { read } from '../../core/db/read.ts'
import { readLogs } from '../../core/log/index.ts'
import { buildLocalIdExport } from '../../core/diagnostics/consistency.ts'
import type { SyncRequests } from '../../core/sync/protocol.ts'
import { strings } from '../../ui/strings.ts'

/** Newest log entries shown on the page. */
const LOG_LIMIT = 100

const client = createClient<SyncRequests>()

function el(id: string): HTMLElement {
  const node = document.getElementById(id)
  if (!node) throw new Error(`missing #${id}`)
  return node
}

function show(id: string, value: unknown): void {
  el(id).textContent = JSON.stringify(value, null, 2)
}

async function renderSyncStatus(): Promise<void> {
  const result = await client.send('sync/getStatus', undefined)
  show('sync-body', result.ok ? result.data : { error: result.error })
}

async function renderOutbox(): Promise<void> {
  const items = await read.outboxItems()
  el('outbox-heading').textContent = strings.debugOutbox(items.length)
  show('outbox-body', items)
}

async function renderLogs(): Promise<void> {
  const logs = (await readLogs()).slice(-LOG_LIMIT).reverse()
  el('logs-heading').textContent = strings.debugLogs(logs.length)
  // Log payloads are content-free by type (core/log/types.ts), so they can be shown as is.
  show('logs-body', logs)
}

async function exportIds(): Promise<void> {
  const data = buildLocalIdExport(await read.idList(), Date.now())
  const json = `${JSON.stringify(data, null, 2)}\n`
  const body = el('export-body')
  body.textContent = json
  body.hidden = false
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  link.download = `noteit-local-ids-${data.exportedAt}.json`
  link.click()
  URL.revokeObjectURL(link.href)
  el('export-status').textContent = strings.debugExported(data.entries.length)
}

function guarded(id: string, task: () => Promise<void>): Promise<void> {
  return task().catch((error: unknown) => {
    el(id).textContent = `${strings.debugLoadFailed}: ${error instanceof Error ? error.message : String(error)}`
  })
}

document.title = strings.debugTitle
el('title').textContent = strings.debugTitle
el('sync-heading').textContent = strings.debugSyncStatus
el('outbox-heading').textContent = strings.debugOutbox(0)
el('logs-heading').textContent = strings.debugLogs(0)
const button = el('export-button')
button.textContent = strings.debugExport
button.addEventListener('click', () => void guarded('export-status', exportIds))

void guarded('sync-body', renderSyncStatus)
void guarded('outbox-body', renderOutbox)
void guarded('logs-body', renderLogs)
