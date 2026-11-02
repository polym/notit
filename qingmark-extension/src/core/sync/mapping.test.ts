import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '../db/schema.ts'
import { readLogs } from '../log/index.ts'
import type { HighlightRecord } from '../model/index.ts'
import { parseRemoteRow, toPushRow } from './mapping.ts'

const RECORD: HighlightRecord = {
  id: 'h-1',
  userId: 'user-1',
  canonicalUrl: 'https://example.com/a',
  siteKey: 'example.com',
  url: 'https://example.com/a?utm_source=x',
  text: 'some text',
  color: 'blue',
  comment: 'note',
  anchor: { start: 1, end: 5, exact: 'some', prefix: 'p', suffix: 's' },
  pageTitle: 'Title',
  favicon: null,
  createdAt: 1_000,
  editedAt: 2_000,
  deviceId: 'device-a',
  deletedAt: null,
  schemaVersion: 1,
}

/** A row as public.highlights returns it (server-owned columns included). */
function remoteRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...toPushRow(RECORD), user_id: 'user-1', server_seq: 7, server_updated_at: '2026-10-19T00:00:00Z', ...overrides }
}

describe('core/sync/mapping', () => {
  beforeEach(async () => {
    await getDb().logs.clear()
  })

  it('maps camelCase records to snake_case push rows without server-owned columns', () => {
    const row = toPushRow(RECORD)
    expect(row).toEqual({
      id: 'h-1',
      canonical_url: 'https://example.com/a',
      site_key: 'example.com',
      url: 'https://example.com/a?utm_source=x',
      text: 'some text',
      color: 'blue',
      comment: 'note',
      anchor: RECORD.anchor,
      page_title: 'Title',
      favicon: null,
      created_at: 1_000,
      edited_at: 2_000,
      device_id: 'device-a',
      deleted_at: null,
    })
    expect(row).not.toHaveProperty('user_id')
    expect(row).not.toHaveProperty('server_seq')
  })

  it('round-trips a valid remote row', () => {
    expect(parseRemoteRow(remoteRow())).toEqual(RECORD)
    expect(parseRemoteRow(remoteRow({ deleted_at: 3_000, anchor: null }))).toEqual({
      ...RECORD,
      deletedAt: 3_000,
      anchor: null,
    })
  })

  it('accepts bigint columns serialized as numeric strings', () => {
    expect(parseRemoteRow(remoteRow({ edited_at: '2000', created_at: '1000' }))).toEqual(RECORD)
  })

  it.each([
    ['missing id', { id: undefined }, 'field:id'],
    ['missing text', { text: undefined }, 'field:text'],
    ['missing user_id', { user_id: undefined }, 'field:user_id'],
    ['invalid color', { color: 'purple' }, 'field:color'],
    ['missing edited_at', { edited_at: undefined }, 'field:edited_at'],
    ['missing deleted_at', { deleted_at: undefined }, 'field:deleted_at'],
    ['bad anchor', { anchor: { start: 'x' } }, 'field:anchor'],
    ['non-string comment', { comment: 5 }, 'field:comment'],
  ])('rejects a row with %s and logs a warn entry', async (_name, overrides, code) => {
    expect(parseRemoteRow(remoteRow(overrides))).toBeNull()
    const logs = await readLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ level: 'warn', scope: 'sync', event: 'remoteRow.invalid', data: { code } })
    // Logs never carry content.
    expect(JSON.stringify(logs[0])).not.toContain('some text')
  })

  it('rejects non-objects', async () => {
    expect(parseRemoteRow(null)).toBeNull()
    expect(parseRemoteRow([remoteRow()])).toBeNull()
    expect((await readLogs()).map((l) => l.level)).toEqual(['warn', 'warn'])
  })
})
