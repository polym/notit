// Sanitizes a public web page into an offline anchoring-corpus snapshot (architecture.md "Testing & CI Architecture").
// - Removes external scripts, tracking inline scripts, <noscript>, <base>, meta refresh and non-stylesheet <link>s.
// - Keeps every other inline script (including body inline scripts, which exercise offset-base bugs, issue #5).
// - Inlines external stylesheets as <style> and neutralizes url() / @import inside CSS so nothing is fetched.
// - Replaces external media (img, iframe, video, ...) with inert placeholders and drops tracking links.
// - Redacts e-mail addresses.
// Usage:
//   node scripts/corpus-sanitize.ts <url> <out/page.html>
//   node scripts/corpus-sanitize.ts --file <saved.html> --base <original-url> <out/page.html>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Hostname fragments of common tracking, analytics and ad services. */
export const TRACKING_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'googlesyndication.com',
  'googleadservices.com',
  'doubleclick.net',
  'adservice.google.',
  'connect.facebook.net',
  'facebook.com/tr',
  'hotjar.com',
  'segment.com',
  'segment.io',
  'mixpanel.com',
  'scorecardresearch.com',
  'quantserve.com',
  'chartbeat.com',
  'newrelic.com',
  'nr-data.net',
  'cloudflareinsights.com',
  'plausible.io',
  'matomo',
  'piwik',
  'criteo.',
  'taboola.com',
  'outbrain.com',
  'adnxs.com',
  'amazon-adsystem.com',
  'stats.wp.com',
  'intake-analytics.wikimedia.org',
  'analytics.python.org',
]

const TRACKING_CALLS = /\b(gtag|fbq|_paq|_gaq|GoogleAnalyticsObject|dataLayer\.push|mixpanel\.|analytics\.(track|page)|hj)\s*[(.=[]/

const PLACEHOLDER_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const REDACTED_EMAIL = 'redacted@example.com'

export interface SanitizeOptions {
  /** Original page URL; relative stylesheet links are resolved against it. */
  baseUrl: string
  /** Fetches a stylesheet. When absent (or it throws) the stylesheet is dropped. */
  fetchText?: (url: string) => Promise<string>
}

export function isTrackingUrl(value: string): boolean {
  const lower = value.toLowerCase()
  return TRACKING_DOMAINS.some((domain) => lower.includes(domain))
}

/** True for values a browser would fetch from somewhere other than the document itself. */
function isFetchable(value: string): boolean {
  const v = value.trim().toLowerCase()
  return v !== '' && !v.startsWith('data:') && !v.startsWith('#') && !v.startsWith('blob:') && !v.startsWith('about:')
}

/** Removes @import rules and points every non-data url() at an empty data URL. */
export function sanitizeCss(css: string): string {
  return css
    .replace(/@import\s+[^;]+;?/gi, '')
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, _quote: string, value: string) =>
      isFetchable(value) ? 'url("data:,")' : match,
    )
}

interface Attr {
  name: string
  value: string | null
}

const ATTR = /([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g

function parseTag(tag: string): { name: string; attrs: Attr[]; selfClosing: boolean } {
  const m = /^<\s*([^\s/>]+)([\s\S]*?)(\/?)\s*>$/.exec(tag)
  if (!m) return { name: '', attrs: [], selfClosing: false }
  const attrs: Attr[] = []
  for (const a of m[2].matchAll(ATTR)) {
    const raw = a[2]
    const value = raw === undefined ? null : raw.replace(/^["']|["']$/g, '')
    attrs.push({ name: a[1], value })
  }
  return { name: m[1].toLowerCase(), attrs, selfClosing: m[3] === '/' }
}

function escapeAttr(value: string): string {
  return value.replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/"/g, '&quot;')
}

function buildTag(name: string, attrs: Attr[], selfClosing: boolean): string {
  const parts = attrs.map((a) => (a.value === null ? a.name : `${a.name}="${escapeAttr(a.value)}"`))
  return `<${name}${parts.length ? ' ' + parts.join(' ') : ''}${selfClosing ? ' /' : ''}>`
}

function getAttr(attrs: Attr[], name: string): string | null {
  return attrs.find((a) => a.name.toLowerCase() === name)?.value ?? null
}

const MEDIA_SRC_TAGS = new Set(['iframe', 'frame', 'embed'])
const DROP_SRC_TAGS = new Set(['video', 'audio', 'source', 'track', 'input'])

/** Rewrites one start tag, dropping or neutralizing attributes that would fetch or track. */
function sanitizeStartTag(tag: string): string {
  const { name, attrs, selfClosing } = parseTag(tag)
  const out: Attr[] = []
  for (const attr of attrs) {
    const key = attr.name.toLowerCase()
    let value = attr.value
    if (key.startsWith('on') && value !== null && isTrackingUrl(value)) continue
    if (key === 'ping' || key === 'srcset' || key === 'imagesrcset' || key === 'background') continue
    if (value !== null) value = value.replace(EMAIL, REDACTED_EMAIL)
    if (key === 'style' && value !== null) value = sanitizeCss(value)
    if (key === 'src' && value !== null && isFetchable(value)) {
      if (name === 'img') value = PLACEHOLDER_IMAGE
      else if (MEDIA_SRC_TAGS.has(name)) value = 'about:blank'
      else if (DROP_SRC_TAGS.has(name)) continue
      else continue
    }
    if (key === 'poster' && value !== null && isFetchable(value)) continue
    if (key === 'data' && name === 'object' && value !== null && isFetchable(value)) continue
    if ((key === 'href' || key === 'xlink:href') && value !== null) {
      // SVG <image>/<use>/<feImage> fetch their href; anchors only navigate on click.
      if (['image', 'use', 'feimage'].includes(name) && isFetchable(value)) continue
      if (isTrackingUrl(value)) value = '#'
      if (value.toLowerCase().startsWith('mailto:')) value = `mailto:${REDACTED_EMAIL}`
    }
    if ((key === 'action' || key === 'formaction') && value !== null) value = '#'
    out.push({ name: attr.name, value })
  }
  return buildTag(name, out, selfClosing)
}

// Tokens: comments, raw-text elements (script/style/noscript/textarea/title), other tags, text.
const TOKEN =
  /<!--[\s\S]*?-->|<(script|style|noscript|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>|<!?[A-Za-z/][^>]*>|[^<]+|</g

export async function sanitizeHtml(html: string, options: SanitizeOptions): Promise<string> {
  const pieces: string[] = []
  for (const match of html.matchAll(TOKEN)) {
    const token = match[0]
    const rawTextTag = match[1]?.toLowerCase()

    if (token.startsWith('<!--')) continue

    if (rawTextTag) {
      const openEnd = token.indexOf('>') + 1
      const closeStart = token.toLowerCase().lastIndexOf('</')
      const open = token.slice(0, openEnd)
      const body = token.slice(openEnd, closeStart)
      const { attrs } = parseTag(open)
      if (rawTextTag === 'noscript') continue
      if (rawTextTag === 'script') {
        if (getAttr(attrs, 'src') !== null) continue
        if (isTrackingUrl(body) || TRACKING_CALLS.test(body)) continue
        pieces.push(token)
        continue
      }
      if (rawTextTag === 'style') {
        pieces.push(`${sanitizeStartTag(open)}${sanitizeCss(body)}</style>`)
        continue
      }
      // textarea / title: text content only.
      pieces.push(`${sanitizeStartTag(open)}${body.replace(EMAIL, REDACTED_EMAIL)}</${rawTextTag}>`)
      continue
    }

    if (token.startsWith('</') || token.startsWith('<!')) {
      pieces.push(token)
      continue
    }

    if (token.startsWith('<') && token.length > 1) {
      const { name, attrs } = parseTag(token)
      if (name === 'base') continue
      if (name === 'meta' && (getAttr(attrs, 'http-equiv') ?? '').toLowerCase() === 'refresh') continue
      if (name === 'link') {
        const rel = (getAttr(attrs, 'rel') ?? '').toLowerCase().split(/\s+/)
        const href = getAttr(attrs, 'href')
        if (!rel.includes('stylesheet') || href === null || isTrackingUrl(href) || !options.fetchText) continue
        const url = new URL(href.replace(/&amp;/g, '&'), options.baseUrl).href
        let css: string
        try {
          css = await options.fetchText(url)
        } catch {
          continue
        }
        const media = getAttr(attrs, 'media')
        const mediaAttr = media ? ` media="${escapeAttr(media)}"` : ''
        pieces.push(`<style data-noteit-inlined="${escapeAttr(url)}"${mediaAttr}>${sanitizeCss(css)}</style>`)
        continue
      }
      pieces.push(sanitizeStartTag(token))
      continue
    }

    pieces.push(token.replace(EMAIL, REDACTED_EMAIL))
  }
  return pieces.join('')
}

/** Lists everything in a snapshot that would load a remote script, call a tracker or fetch an external resource. */
export function findSanitizeViolations(html: string): string[] {
  const violations: string[] = []
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=/gi)) violations.push(`external script: ${m[0]}`)
  for (const domain of TRACKING_DOMAINS) {
    if (html.toLowerCase().includes(domain)) violations.push(`tracking domain: ${domain}`)
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) violations.push(`link element: ${m[0]}`)
  for (const m of html.matchAll(/<(img|iframe|frame|embed|video|audio|source|track)\b[^>]*\bsrc\s*=\s*["']?(https?:)?\/\//gi)) {
    violations.push(`external media: ${m[0]}`)
  }
  for (const m of html.matchAll(/url\(\s*["']?(https?:)?\/\//gi)) violations.push(`external css url: ${m[0]}`)
  for (const m of html.matchAll(/@import\b/gi)) violations.push(`css import: ${m[0]}`)
  return violations
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.text()
}

async function main(argv: string[]): Promise<void> {
  let input: string
  let baseUrl: string
  let outFile: string
  if (argv[0] === '--file') {
    const [, file, flag, base, out] = argv
    if (!file || flag !== '--base' || !base || !out) throw new Error('usage: --file <in.html> --base <url> <out.html>')
    input = readFileSync(file, 'utf8')
    baseUrl = base
    outFile = out
  } else {
    const [url, out] = argv
    if (!url || !out) throw new Error('usage: corpus-sanitize.ts <url> <out.html>')
    input = await fetchText(url)
    baseUrl = url
    outFile = out
  }
  const sanitized = await sanitizeHtml(input, { baseUrl, fetchText })
  const violations = findSanitizeViolations(sanitized)
  if (violations.length > 0) {
    throw new Error(`sanitized snapshot still has violations:\n  ${violations.join('\n  ')}`)
  }
  mkdirSync(dirname(resolve(outFile)), { recursive: true })
  writeFileSync(outFile, sanitized)
  console.log(`wrote ${outFile} (${sanitized.length} chars) from ${baseUrl}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
