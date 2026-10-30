// Story 2.21: manifest permission snapshot (NFR15, #20). The permission set must stay exactly the
// least-privilege list; adding one is a deliberate change to this test.
import { describe, expect, it } from 'vitest'
import manifest from '../manifest.config.ts'

const EXPECTED_PERMISSIONS = ['storage', 'sidePanel', 'contextMenus', 'tabs', 'alarms']

/** Fields this test reads; scripts/ is type-checked without the chrome types. */
interface ManifestFields {
  permissions?: string[]
  host_permissions?: string[]
  optional_permissions?: string[]
  optional_host_permissions?: string[]
  content_scripts?: Array<{ matches?: string[] }>
}

describe('manifest permissions', () => {
  const resolved = manifest as ManifestFields

  it('requests exactly the least-privilege permission set', () => {
    expect([...(resolved.permissions ?? [])].sort()).toEqual([...EXPECTED_PERMISSIONS].sort())
    expect(resolved.permissions).toHaveLength(EXPECTED_PERMISSIONS.length)
  })

  it('does not request scripting or activeTab', () => {
    expect(resolved.permissions).not.toContain('scripting')
    expect(resolved.permissions).not.toContain('activeTab')
  })

  it('adds no host_permissions or optional permissions', () => {
    expect(resolved.host_permissions).toBeUndefined()
    expect(resolved.optional_permissions).toBeUndefined()
  })

  it('declares https origins only as optional host permissions (translation provider, granted per origin)', () => {
    expect(resolved.optional_host_permissions).toEqual(['https://*/*'])
  })

  it('keeps the content script match as the only host access', () => {
    expect(resolved.content_scripts?.map((c) => c.matches)).toEqual([['<all_urls>']])
  })
})
