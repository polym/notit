import { describe, expect, it } from 'vitest'
import { checkRelease, countBackupRows, formatChecklist, releaseTag, rowCountSql, type ReleaseFacts } from './release-m1-checklist.ts'

function facts(overrides: Partial<ReleaseFacts> = {}): ReleaseFacts {
  return { packageVersion: '1.0.0', manifestVersion: '1.0.0', existingTags: ['v0.0.1'], scanStatus: 0, backupRows: null, ...overrides }
}

describe('checkRelease', () => {
  it('passes when versions match, the tag is new and scan:dist passed', () => {
    expect(checkRelease(facts())).toEqual([])
  })

  it('reports a missing build, a version mismatch, an existing tag and a failed scan', () => {
    expect(checkRelease(facts({ manifestVersion: null, scanStatus: null }))).toEqual([
      'dist/manifest.json not found; run npm run build first',
      'scan:dist failed (exit not run)',
    ])
    expect(checkRelease(facts({ manifestVersion: '0.9.0' }))[0]).toMatch(/0\.9\.0 != package\.json version 1\.0\.0/)
    expect(checkRelease(facts({ existingTags: ['v1.0.0'] }))[0]).toMatch(/tag v1\.0\.0 already exists/)
    expect(checkRelease(facts({ scanStatus: 1 }))).toEqual(['scan:dist failed (exit 1)'])
  })
})

describe('countBackupRows', () => {
  it('counts a JSON array and rejects anything else', () => {
    expect(countBackupRows('[{"id":"a"},{"id":"b"}]')).toBe(2)
    expect(() => countBackupRows('{"id":"a"}')).toThrow(/JSON array/)
  })
})

describe('formatChecklist', () => {
  const text = formatChecklist(facts({ backupRows: 42 }), [])

  it('lists the escalations in the handoff order E1, E3, E2, E4, E6, E5', () => {
    const order = ['1. E1', '2. E3', '3. E2', '4. E4', '5. E6', '6. E5'].map((s) => text.indexOf(s))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('includes version, scan result, backup, dry-run, migrate, row check, rollback, tag and daily check commands', () => {
    expect(text).toContain('package.json 1.0.0, dist/manifest.json 1.0.0')
    expect(text).toContain('scan:dist: pass')
    expect(text).toContain('result: READY')
    expect(text).toContain('migrate-legacy.ts --backup backup-highlights-legacy.json --source highlights')
    expect(text).toContain('migrate-legacy.ts --user <uid> --dry-run')
    expect(text).toContain('supabase db push')
    expect(text).toContain(rowCountSql())
    expect(text).toContain('Expected: 42 - skipped')
    expect(text).toContain('scripts/rollback-v2.sql')
    expect(text).toContain(`git tag ${releaseTag('1.0.0')}`)
    expect(text).toContain('verify-consistency.ts <device-a.json> <device-b.json>')
  })

  it('never embeds credentials, only placeholders', () => {
    expect(text).not.toMatch(/eyJ[\w-]+\.[\w-]+\./)
    expect(text).not.toMatch(/sb_secret_\w/)
    expect(text).toContain('SUPABASE_SERVICE_ROLE_KEY=<key>')
  })

  it('marks the result NOT READY with the failures', () => {
    expect(formatChecklist(facts(), ['x failed'])).toContain('result: NOT READY\n  - x failed')
  })
})
