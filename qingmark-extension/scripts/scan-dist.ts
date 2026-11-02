// Scans the build output for secrets and records the content-script gzip size (NFR13, architecture.md
// "Authentication & Security" and "Bundle").
// - Fails on the literal `service_role`, on the chrome synced storage area name, on an `sb_secret_<key>` value, or on a JWT whose decoded payload
//   has a role other than 'anon'. supabase-js itself contains the bare `sb_secret_` prefix in a key-format
//   check, so only a prefix followed by key characters counts.
// - Sums the gzip size of every file the manifest content scripts load (static imports, dynamic imports and
//   chrome.runtime.getURL references are followed) and fails when it regresses > 20% over
//   tests/perf/bundle-baseline.json, and fails when those files contain React, supabase-js or Dexie. The < 40KB target is only reported until M2 replaces the legacy content code.
// Usage:
//   node scripts/scan-dist.ts [distDir]                    -> scan + bundle gate (default dist/)
//   node scripts/scan-dist.ts [distDir] --update-baseline  -> scan + rewrite tests/perf/bundle-baseline.json
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

export const BUNDLE_BASELINE_PATH = resolve(import.meta.dirname, '../tests/perf/bundle-baseline.json')
/** Allowed regression of the content gzip size over the baseline. */
export const BUNDLE_REGRESSION_LIMIT = 0.2
/** Target content gzip size; reported only, not enforced (architecture.md "Bundle" [proxy]). */
export const BUNDLE_TARGET_BYTES = 40 * 1024

export interface SecretFinding {
  file: string
  rule: 'service_role' | 'sb_secret' | 'jwt-role' | 'synced-storage'
  detail: string
}

export interface BundleBaseline {
  contentGzipBytes: number
}

export interface BundleCheck {
  ok: boolean
  limitBytes: number
  overTarget: boolean
}

// Built from parts so this file itself does not contain the literal.
const STORAGE_SYNC_LITERAL = ['storage', 'sync'].join('.')
const SB_SECRET = /sb_secret_[A-Za-z0-9_-]{8,}/g
const JWT = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g

/** Decodes the payload of a JWT; returns undefined when it is not valid base64url JSON. */
export function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const payload = token.split('.')[1]
  if (!payload) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** Returns every secret finding in one file's text. */
export function scanText(file: string, text: string): SecretFinding[] {
  const findings: SecretFinding[] = []
  // The session and data must never use the browser-account synced storage (#21, NFR14).
  if (text.includes(STORAGE_SYNC_LITERAL)) {
    findings.push({ file, rule: 'synced-storage', detail: `literal "${STORAGE_SYNC_LITERAL}"` })
  }
  if (text.includes('service_role')) {
    findings.push({ file, rule: 'service_role', detail: 'literal "service_role"' })
  }
  for (const match of text.matchAll(SB_SECRET)) {
    findings.push({ file, rule: 'sb_secret', detail: `${match[0].slice(0, 14)}...` })
  }
  for (const match of text.matchAll(JWT)) {
    const payload = decodeJwtPayload(match[0])
    if (!payload) continue
    if (payload.role !== 'anon') {
      findings.push({ file, rule: 'jwt-role', detail: `JWT role=${JSON.stringify(payload.role)}` })
    }
  }
  return findings
}

function listFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...listFiles(path))
    else out.push(path)
  }
  return out.sort()
}

/** Scans every file under dir (any extension; binary files are scanned as latin1 text). */
export function scanDir(dir: string): SecretFinding[] {
  return listFiles(dir).flatMap((path) => scanText(relative(dir, path).split('\\').join('/'), readFileSync(path, 'latin1')))
}

const IMPORT_REFS = [
  /\bfrom\s*["'`]([^"'`]+)["'`]/g,
  /\bimport\s*\(\s*(?:\/\*[^]*?\*\/\s*)?["'`]([^"'`]+)["'`]\s*\)/g,
  /\bimport\s*["'`]([^"'`]+)["'`]/g,
  /chrome\.runtime\.getURL\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
]

/** Returns the dist-relative files the manifest content scripts load, following import references. */
export function contentScriptFiles(distDir: string): string[] {
  const manifest = JSON.parse(readFileSync(join(distDir, 'manifest.json'), 'utf8')) as {
    content_scripts?: { js?: string[] }[]
  }
  const queue = (manifest.content_scripts ?? []).flatMap((cs) => cs.js ?? []).map((p) => normalize(p))
  const seen = new Set<string>()
  while (queue.length > 0) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    const path = join(distDir, file)
    if (!existsSync(path)) throw new Error(`content script file not found in ${distDir}: ${file}`)
    seen.add(file)
    const text = readFileSync(path, 'utf8')
    for (const pattern of IMPORT_REFS) {
      for (const match of text.matchAll(pattern)) {
        const ref = match[1]
        // getURL paths are extension-root relative; module specifiers are file relative ("./", "../")
        // or root relative ("/"). Anything else (bare names, URLs, text inside strings) is ignored.
        const isGetUrl = pattern.source.startsWith('chrome')
        if (!isGetUrl && !/^\.{0,2}\//.test(ref)) continue
        if (/^[a-z]+:/i.test(ref)) continue
        const isRootRelative = isGetUrl || ref.startsWith('/')
        const target = normalize(isRootRelative ? ref.replace(/^\//, '') : join(dirname(file), ref))
        queue.push(target)
      }
    }
  }
  return [...seen].map((f) => f.split('\\').join('/')).sort()
}

/**
 * Libraries the content bundle must not contain (architecture.md "Bundle"): content never touches the
 * database, the session or React. Each marker is a string the library's minified build keeps.
 */
export const CONTENT_FORBIDDEN_LIBS: readonly { name: string; marker: RegExp }[] = [
  { name: 'react', marker: /Symbol\.for\(\s*["'`]react\./ },
  { name: '@supabase/supabase-js', marker: /supabase-js/ },
  { name: 'dexie', marker: /\bDexie(Error)?\b/ },
]

/** Names of forbidden libraries found in the given dist-relative files. */
export function forbiddenContentLibs(distDir: string, files: string[]): string[] {
  const text = files.map((f) => readFileSync(join(distDir, f), 'utf8')).join('\n')
  return CONTENT_FORBIDDEN_LIBS.filter((lib) => lib.marker.test(text)).map((lib) => lib.name)
}

/** Total gzip size of the given dist-relative files. */
export function gzipBytes(distDir: string, files: string[]): number {
  return files.reduce((sum, f) => sum + gzipSync(readFileSync(join(distDir, f))).length, 0)
}

/** Compares the content gzip size to the baseline: fails above baseline * (1 + 20%). */
export function checkBundle(bytes: number, baseline: BundleBaseline): BundleCheck {
  const limitBytes = Math.floor(baseline.contentGzipBytes * (1 + BUNDLE_REGRESSION_LIMIT))
  return { ok: bytes <= limitBytes, limitBytes, overTarget: bytes > BUNDLE_TARGET_BYTES }
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)}KB`

function main(args: string[]): number {
  const update = args.includes('--update-baseline')
  const distDir = resolve(args.find((a) => !a.startsWith('--')) ?? 'dist')
  if (!existsSync(join(distDir, 'manifest.json'))) {
    console.error(`scan-dist: ${distDir}/manifest.json not found; run npm run build first`)
    return 1
  }

  let failed = false
  const findings = scanDir(distDir)
  if (findings.length > 0) {
    failed = true
    console.error(`scan-dist: ${findings.length} secret finding(s) in ${distDir}`)
    for (const f of findings) console.error(`  - ${f.file}: [${f.rule}] ${f.detail}`)
  } else {
    console.log('scan-dist: no service_role, sb_secret_ or non-anon JWT found')
  }

  const files = contentScriptFiles(distDir)
  const bytes = gzipBytes(distDir, files)
  const forbidden = forbiddenContentLibs(distDir, files)
  if (forbidden.length > 0) {
    failed = true
    console.error(`scan-dist: content bundle contains forbidden libraries: ${forbidden.join(', ')}`)
  } else {
    console.log('scan-dist: content bundle contains no React, supabase-js or Dexie')
  }
  console.log(`scan-dist: content gzip ${bytes} bytes (${kb(bytes)}) across ${files.length} file(s): ${files.join(', ')}`)
  if (bytes > BUNDLE_TARGET_BYTES) {
    console.log(`scan-dist: content gzip exceeds the ${kb(BUNDLE_TARGET_BYTES)} target (reported only, not blocking)`)
  }

  if (update) {
    const baseline: BundleBaseline = { contentGzipBytes: bytes }
    writeFileSync(BUNDLE_BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`)
    console.log(`scan-dist: wrote ${relative(process.cwd(), BUNDLE_BASELINE_PATH)}`)
  } else if (!existsSync(BUNDLE_BASELINE_PATH)) {
    failed = true
    console.error(`scan-dist: ${BUNDLE_BASELINE_PATH} missing; run node scripts/scan-dist.ts --update-baseline`)
  } else {
    const baseline = JSON.parse(readFileSync(BUNDLE_BASELINE_PATH, 'utf8')) as BundleBaseline
    const check = checkBundle(bytes, baseline)
    if (check.ok) {
      console.log(`scan-dist: within ${BUNDLE_REGRESSION_LIMIT * 100}% of baseline ${baseline.contentGzipBytes} bytes (limit ${check.limitBytes})`)
    } else {
      failed = true
      console.error(
        `scan-dist: content gzip ${bytes} bytes regressed > ${BUNDLE_REGRESSION_LIMIT * 100}% over baseline ${baseline.contentGzipBytes} bytes (limit ${check.limitBytes})`,
      )
    }
  }
  return failed ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
