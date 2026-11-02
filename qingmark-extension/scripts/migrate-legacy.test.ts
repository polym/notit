import { describe, expect, it } from 'vitest'
import {
  LEGACY_DEVICE_ID,
  formatPlan,
  legacyAnchor,
  parseArgs,
  planMigration,
  transformLegacyRow,
  type LegacyRow,
} from './migrate-legacy.ts'

const USER = '00000000-0000-4000-a000-00000000000a'

function legacy(overrides: Partial<LegacyRow> = {}): LegacyRow {
  return {
    id: 'l-1',
    text: 'selected words',
    url: 'https://www.example.com/a?x=1&utm_source=n#h',
    color: '#a5d6a7',
    timestamp: 1700000000000,
    pageTitle: 'A',
    favicon: null,
    comment: 'note',
    start: 10,
    length: 14,
    context: { prefix: 'before ', suffix: ' after', offset: 10 },
    xpath: null,
    ...overrides,
  }
}

describe('legacyAnchor', () => {
  it('builds end = start + length with prefix / suffix from context', () => {
    expect(legacyAnchor(legacy())).toEqual({ start: 10, end: 24, exact: 'selected words', prefix: 'before ', suffix: ' after' })
  })

  it('returns null without start', () => {
    expect(legacyAnchor(legacy({ start: null }))).toBeNull()
  })

  it('falls back to the text length and trims context to 32 characters', () => {
    const anchor = legacyAnchor(legacy({ length: null, context: { prefix: 'p'.repeat(40) + 'END', suffix: 'BEG' + 's'.repeat(40) } }))
    expect(anchor?.end).toBe(24)
    expect(anchor?.prefix).toHaveLength(32)
    expect(anchor?.prefix.endsWith('END')).toBe(true)
    expect(anchor?.suffix).toHaveLength(32)
    expect(anchor?.suffix.startsWith('BEG')).toBe(true)
  })

  it('treats null or malformed context as empty strings', () => {
    expect(legacyAnchor(legacy({ context: null }))).toMatchObject({ prefix: '', suffix: '' })
    expect(legacyAnchor(legacy({ context: { prefix: 3 } }))).toMatchObject({ prefix: '', suffix: '' })
  })
})

describe('transformLegacyRow', () => {
  it('maps every column', () => {
    const result = transformLegacyRow(legacy(), USER)
    expect(result).toEqual({
      ok: true,
      row: {
        id: 'l-1',
        user_id: USER,
        canonical_url: 'https://www.example.com/a?x=1',
        site_key: 'example.com',
        url: 'https://www.example.com/a?x=1&utm_source=n#h',
        text: 'selected words',
        color: 'green',
        comment: 'note',
        anchor: { start: 10, end: 24, exact: 'selected words', prefix: 'before ', suffix: ' after' },
        page_title: 'A',
        favicon: null,
        created_at: 1700000000000,
        edited_at: 1700000000000,
        device_id: LEGACY_DEVICE_ID,
        deleted_at: null,
      },
    })
  })

  it('rejects non-http(s) URLs', () => {
    expect(transformLegacyRow(legacy({ url: 'chrome://settings' }), USER)).toEqual({ ok: false, reason: 'unsupported url' })
  })
})

describe('planMigration', () => {
  it('splits inserts, existing and skipped rows and orders inserts by timestamp', () => {
    const rows = [
      legacy({ id: 'c', timestamp: 3 }),
      legacy({ id: 'a', timestamp: 2, start: null }),
      legacy({ id: 'b', timestamp: 1, color: 'rgb(250, 230, 60)' }),
      legacy({ id: 'd', timestamp: 4, url: 'file:///x' }),
    ]
    const plan = planMigration(rows, new Set(['c']), USER)
    expect(plan.inserts.map((r) => r.id)).toEqual(['b', 'a'])
    expect(plan.existing).toEqual(['c'])
    expect(plan.skipped).toEqual([{ id: 'd', reason: 'unsupported url' }])
    expect(plan.nullAnchors).toBe(1)
    expect(plan.colors).toEqual({ green: 1, yellow: 1 })
    const text = formatPlan(plan, rows)
    expect(text).toContain('legacy rows:      4')
    expect(text).toContain('+ b  color rgb(250, 230, 60) -> yellow')
    expect(text).toContain('= c  already in public.highlights')
    expect(text).toContain('! d  skipped: unsupported url (file:///x)')
  })
})

describe('parseArgs', () => {
  it('parses all flags', () => {
    expect(parseArgs(['--user', USER, '--dry-run', '--backup', 'b.json'])).toEqual({ user: USER, dryRun: true, backup: 'b.json', source: 'highlights_legacy' })
  })

  it('allows a backup-only run, and --source highlights only for it', () => {
    expect(parseArgs(['--backup', 'b.json', '--source', 'highlights'])).toEqual({ user: '', dryRun: false, backup: 'b.json', source: 'highlights' })
    expect(parseArgs(['--backup', 'b.json'])).toEqual({ user: '', dryRun: false, backup: 'b.json', source: 'highlights_legacy' })
    expect(() => parseArgs(['--user', USER, '--source', 'highlights'])).toThrow(/only allowed for a backup/)
    expect(() => parseArgs(['--backup', 'b.json', '--source', 'other'])).toThrow(/--source must be/)
    expect(() => parseArgs(['--backup', 'b.json', '--dry-run'])).toThrow(/--user/)
  })

  it('requires a uuid --user and rejects unknown flags', () => {
    expect(() => parseArgs([])).toThrow(/--user/)
    expect(() => parseArgs(['--user', 'nope'])).toThrow(/uuid/)
    expect(() => parseArgs(['--user', USER, '--force'])).toThrow(/unknown/)
    expect(() => parseArgs(['--user', USER, '--backup'])).toThrow(/needs a value/)
  })
})
