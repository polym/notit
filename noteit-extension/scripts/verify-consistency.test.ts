// Story 2.23: SC-1 consistency check. Two device exports + a cloud snapshot -> missing / duplicate counts.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildLocalIdExport,
  compareConsistency,
  parseLocalIdExport,
  type LocalIdExport,
} from '../src/core/diagnostics/consistency.ts'
import { assertAnonKey, formatReport, parseArgs, parseCloudRows } from './verify-consistency.ts'

const ROOT = resolve(import.meta.dirname, '..')
const FIXTURES = join(ROOT, 'tests/fixtures/consistency')

function load(name: string): { a: LocalIdExport; b: LocalIdExport; cloud: ReturnType<typeof parseCloudRows> } {
  const json = (file: string) => JSON.parse(readFileSync(join(FIXTURES, name, file), 'utf8')) as unknown
  return {
    a: parseLocalIdExport(json('device-a.json')),
    b: parseLocalIdExport(json('device-b.json')),
    cloud: parseCloudRows(json('cloud.json')),
  }
}

function report(name: string) {
  const { a, b, cloud } = load(name)
  return compareConsistency(
    [
      { name: 'a', export: a },
      { name: 'b', export: b },
    ],
    cloud,
  )
}

/** Runs the CLI against a fixture with a saved cloud snapshot (no network). */
function runCli(name: string): { code: number; out: string } {
  const dir = join(FIXTURES, name)
  const args = ['scripts/verify-consistency.ts', join(dir, 'device-a.json'), join(dir, 'device-b.json'), '--cloud', join(dir, 'cloud.json')]
  try {
    return { code: 0, out: execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' }) }
  } catch (error) {
    const e = error as { status: number; stdout: string }
    return { code: e.status, out: e.stdout }
  }
}

describe('compareConsistency', () => {
  it('reports 0 / 0 for the consistent fixture', () => {
    const r = report('consistent')
    expect(r.missing).toBe(0)
    expect(r.duplicates).toBe(0)
    expect(r.mismatched).toBe(0)
  })

  it('reports the expected numbers for the known-diff fixture', () => {
    const r = report('known-diff')
    // a1 only on device A; c4 and c5 missing on device B.
    expect(r.missing).toBe(3)
    // c4 is the same text at the same position as c1; the deleted c5 does not count.
    expect(r.duplicates).toBe(1)
    expect(r.duplicateGroups).toEqual([['c1', 'c4']])
    // c2 has an older editedAt on device B.
    expect(r.mismatched).toBe(1)
    expect(r.devices).toEqual([
      { name: 'a', missingLocally: [], missingInCloud: ['a1'], mismatched: [] },
      { name: 'b', missingLocally: ['c4', 'c5'], missingInCloud: [], mismatched: ['c2'] },
    ])
  })

  it('does not count rows with a null anchor as duplicates', () => {
    // n1 and n2 share page and text but have no known position (migrated legacy rows).
    const r = report('null-anchor')
    expect(r.missing).toBe(0)
    expect(r.duplicates).toBe(0)
    expect(r.duplicateGroups).toEqual([])
  })

  it('the report prints ids and counts only', () => {
    const text = formatReport(report('known-diff'))
    expect(text).toContain('missing: 3')
    expect(text).toContain('duplicates: 1')
    expect(text).not.toContain('alpha')
    expect(text).not.toContain('example.com')
  })
})

describe('verify-consistency CLI', () => {
  it('exits 0 and prints 0 / 0 on the consistent fixture', () => {
    const { code, out } = runCli('consistent')
    expect(code).toBe(0)
    expect(out).toContain('missing: 0')
    expect(out).toContain('duplicates: 0')
  })

  it('exits 1 on the known-diff fixture', () => {
    const { code, out } = runCli('known-diff')
    expect(code).toBe(1)
    expect(out).toContain('missing: 3')
    expect(out).toContain('duplicates: 1')
  })
})

describe('local id export', () => {
  it('keeps only id, editedAt and deletedAt, sorted by id', () => {
    const rows = [
      { id: 'b', editedAt: 2, deletedAt: null, text: 'secret', url: 'https://x' },
      { id: 'a', editedAt: 1, deletedAt: 5, comment: 'c' },
    ]
    const exp = buildLocalIdExport(rows, 10)
    expect(exp).toEqual({
      kind: 'noteit/local-ids',
      version: 1,
      exportedAt: 10,
      entries: [
        { id: 'a', editedAt: 1, deletedAt: 5 },
        { id: 'b', editedAt: 2, deletedAt: null },
      ],
    })
    expect(parseLocalIdExport(JSON.parse(JSON.stringify(exp)))).toEqual(exp)
  })

  it('rejects files that are not an export', () => {
    expect(() => parseLocalIdExport({ entries: [] })).toThrow(/kind/)
    expect(() => parseLocalIdExport({ kind: 'noteit/local-ids', version: 1, exportedAt: 1, entries: [{ id: 'x' }] })).toThrow(/entry 0/)
  })
})

describe('cli guards', () => {
  it('needs exactly two device files', () => {
    expect(() => parseArgs(['a.json'])).toThrow(/two device/)
    expect(parseArgs(['a.json', 'b.json', '--cloud', 'c.json'])).toEqual({ devices: ['a.json', 'b.json'], cloud: 'c.json' })
  })

  it('refuses service role and secret keys', () => {
    const jwt = (role: string) => `x.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.y`
    expect(() => assertAnonKey(jwt('service_role'))).toThrow(/not an anon key/)
    expect(() => assertAnonKey('sb_secret_abc')).toThrow(/secret key/)
    expect(() => assertAnonKey(jwt('anon'))).not.toThrow()
    expect(() => assertAnonKey('sb_publishable_abc')).not.toThrow()
  })

  it('parses bigint columns that arrive as strings', () => {
    const [row] = parseCloudRows([{ id: 'x', canonical_url: 'u', text: 't', anchor: null, edited_at: '12', deleted_at: null }])
    expect(row.edited_at).toBe(12)
  })
})
