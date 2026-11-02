import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EDGE_SMOKE, KEY_FLOW_E2E, formatChecklist, smokeMinutes } from './release-m2-checklist.ts'
import type { ReleaseFacts } from './release-m1-checklist.ts'

function facts(overrides: Partial<ReleaseFacts> = {}): ReleaseFacts {
  return { packageVersion: '1.0.0', manifestVersion: '1.0.0', existingTags: ['v0.0.1'], scanStatus: 0, backupRows: null, ...overrides }
}

describe('M2 release checklist', () => {
  it('keeps the Edge smoke test within 30 minutes', () => {
    expect(EDGE_SMOKE.length).toBeGreaterThan(0)
    expect(smokeMinutes()).toBeLessThanOrEqual(30)
  })

  it('names Key Flow E2E files that exist', () => {
    for (const file of KEY_FLOW_E2E) expect(existsSync(resolve(import.meta.dirname, '..', file))).toBe(true)
  })

  it('lists the gates, the absolute perf run, the E5 tag and every smoke step', () => {
    const text = formatChecklist(facts(), [])
    expect(text).toContain('result: READY')
    expect(text).toContain('npm run verify')
    for (const file of KEY_FLOW_E2E) expect(text).toContain(file)
    expect(text).toContain('npm run test:perf -- --absolute')
    expect(text).toContain('git tag v1.0.0 && git push origin v1.0.0')
    for (const step of EDGE_SMOKE) expect(text).toContain(step.action)
    // Gates come before the tag, the tag before the smoke test.
    expect(text.indexOf('npm run verify')).toBeLessThan(text.indexOf('git tag'))
    expect(text.indexOf('git tag')).toBeLessThan(text.indexOf('Edge smoke test'))
  })

  it('marks the result NOT READY with the failures and never embeds credentials', () => {
    const text = formatChecklist(facts({ existingTags: ['v1.0.0'] }), ['tag v1.0.0 already exists'])
    expect(text).toContain('result: NOT READY\n  - tag v1.0.0 already exists')
    expect(text).toContain('(ALREADY EXISTS)')
    expect(text).not.toMatch(/eyJ[\w-]+\.[\w-]+\./)
    expect(text).not.toMatch(/sb_secret_\w/)
  })
})
