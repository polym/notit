import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  BUNDLE_TARGET_BYTES,
  CONTENT_FORBIDDEN_LIBS,
  checkBundle,
  contentScriptFiles,
  decodeJwtPayload,
  forbiddenContentLibs,
  gzipBytes,
  scanDir,
  scanText,
} from './scan-dist.ts'

const FIXTURES = resolve(import.meta.dirname, '../tests/scan-dist')

describe('scanDir fixtures', () => {
  it.each([
    ['service-role', 'service_role'],
    ['sb-secret', 'sb_secret'],
    ['non-anon-jwt', 'jwt-role'],
  ] as const)('%s fails with rule %s', (fixture, rule) => {
    const findings = scanDir(join(FIXTURES, fixture))
    expect(findings.map((f) => f.rule)).toContain(rule)
  })

  it('clean fixture passes', () => {
    expect(scanDir(join(FIXTURES, 'clean'))).toEqual([])
  })
})

describe('scanText', () => {
  it('ignores the bare sb_secret_ prefix that supabase-js ships', () => {
    expect(scanText('a.js', 'e.startsWith(`sb_secret_`)')).toEqual([])
  })

  it('ignores anon JWTs and undecodable eyJ strings', () => {
    const anon = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('{"role":"anon"}').toString('base64url')}.sig`
    expect(scanText('a.js', `${anon} eyJnot.eyJjson.x`)).toEqual([])
  })

  it('flags a JWT without a role claim', () => {
    const noRole = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('{"sub":"x"}').toString('base64url')}.sig`
    expect(scanText('a.js', noRole).map((f) => f.rule)).toEqual(['jwt-role'])
  })

  it('flags the synced chrome storage area', () => {
    const area = ['storage', 'sync'].join('.')
    expect(scanText('a.js', `chrome.${area}.get(x)`).map((f) => f.rule)).toEqual(['synced-storage'])
    expect(scanText('a.js', 'chrome.storage.local.get(x)')).toEqual([])
  })

  it('does not echo the full secret', () => {
    const [finding] = scanText('a.js', 'sb_secret_abcdefghijklmnopqrstuvwxyz')
    expect(finding.detail).not.toContain('qrstuvwxyz')
  })
})

describe('decodeJwtPayload', () => {
  it('returns undefined for invalid payloads', () => {
    expect(decodeJwtPayload('eyJx.eyJ!!.s')).toBeUndefined()
    expect(decodeJwtPayload('nodots')).toBeUndefined()
  })
})

describe('content bundle', () => {
  const dir = join(FIXTURES, 'clean')

  it('follows getURL and relative imports from the manifest content scripts', () => {
    expect(contentScriptFiles(dir)).toEqual(['assets/content.txt', 'assets/loader.txt', 'assets/runtime.txt'])
  })

  it('sums gzip sizes of the content files only', () => {
    const files = contentScriptFiles(dir)
    const expected = files.reduce((sum, f) => sum + gzipSync(readFileSync(join(dir, f))).length, 0)
    expect(gzipBytes(dir, files)).toBe(expected)
  })

  it('fails only when the size regresses more than 20%', () => {
    expect(checkBundle(1200, { contentGzipBytes: 1000 }).ok).toBe(true)
    expect(checkBundle(1201, { contentGzipBytes: 1000 }).ok).toBe(false)
    expect(checkBundle(500, { contentGzipBytes: 1000 }).ok).toBe(true)
  })

  it('reports the 40KB target without failing', () => {
    const check = checkBundle(BUNDLE_TARGET_BYTES + 1, { contentGzipBytes: BUNDLE_TARGET_BYTES })
    expect(check).toMatchObject({ ok: true, overTarget: true })
  })
})

describe('content forbidden libraries', () => {
  it('clean fixture content files contain none', () => {
    const dir = join(FIXTURES, 'clean')
    expect(forbiddenContentLibs(dir, contentScriptFiles(dir))).toEqual([])
  })

  it.each([
    ['react', 'var e=Symbol.for("react.transitional.element")'],
    ['@supabase/supabase-js', '"X-Client-Info":"supabase-js-web/2.118.0"'],
    ['dexie', 'class t extends DexieError{}'],
  ])('detects %s from its minified marker', (name, text) => {
    const lib = CONTENT_FORBIDDEN_LIBS.find((l) => l.name === name)
    expect(lib?.marker.test(text)).toBe(true)
  })

  it('does not flag unrelated text', () => {
    const text = 'const reactive = 1; const dexterity = 2; supabase.co'
    expect(CONTENT_FORBIDDEN_LIBS.filter((l) => l.marker.test(text))).toEqual([])
  })
})
