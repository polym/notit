import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findSanitizeViolations, sanitizeCss, sanitizeHtml, TRACKING_DOMAINS } from './corpus-sanitize.ts'

const CORPUS_DIR = resolve(import.meta.dirname, '../tests/corpus')

const RAW = `<!DOCTYPE html>
<html><head>
<base href="https://example.org/">
<meta http-equiv="refresh" content="30">
<link rel="preconnect" href="https://fonts.gstatic.com">
<link rel="icon" href="/favicon.ico">
<link rel="stylesheet" href="/css/site.css">
<link rel="stylesheet" href="https://www.googletagmanager.com/x.css">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>
<script>window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments)} gtag('js', new Date());</script>
<script src="/app.js"></script>
<style>@import url("https://fonts.googleapis.com/css?family=Lato"); .hero { background: url(https://cdn.example.org/bg.png) }</style>
</head><body>
<!-- tracking comment https://connect.facebook.net -->
<script>document.documentElement.dataset.theme = 'light'</script>
<p>Contact jane.doe@example.org for details.</p>
<a href="mailto:jane.doe@example.org">mail</a>
<a href="https://ad.doubleclick.net/click?x=1" ping="https://t.example.org">ad</a>
<img src="https://cdn.example.org/a.png" srcset="https://cdn.example.org/a2.png 2x" alt="A">
<iframe src="https://www.youtube.com/embed/1"></iframe>
<video src="https://cdn.example.org/v.mp4" poster="https://cdn.example.org/p.png"></video>
<div style="background-image: url('https://cdn.example.org/x.png')">styled</div>
<noscript><img src="https://www.facebook.com/tr?id=1"></noscript>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>
<script>(function(){ var s = document.createElement('script'); s.src = 'https://static.hotjar.com/c/hotjar.js' })()</script>
</body></html>`

const fetched: string[] = []
const sanitized = await sanitizeHtml(RAW, {
  baseUrl: 'https://example.org/articles/page.html',
  fetchText: async (url) => {
    fetched.push(url)
    return 'body { font: 16px serif; } @font-face { src: url(/fonts/a.woff2) } .x { background: url(data:image/gif;base64,AAAA) }'
  },
})

describe('sanitizeHtml', () => {
  it('removes every external script and tracking inline script', () => {
    expect(sanitized).not.toMatch(/<script\b[^>]*\bsrc\s*=/i)
    expect(sanitized).not.toContain('gtag(')
    expect(sanitized).not.toContain('hotjar')
  })

  it('leaves no common tracking domain anywhere in the snapshot', () => {
    for (const domain of TRACKING_DOMAINS) expect(sanitized.toLowerCase()).not.toContain(domain)
  })

  it('keeps body inline scripts that are not tracking code', () => {
    expect(sanitized).toContain("<script>document.documentElement.dataset.theme = 'light'</script>")
  })

  it('inlines stylesheets resolved against the page URL and neutralizes external CSS urls', () => {
    expect(fetched).toEqual(['https://example.org/css/site.css'])
    expect(sanitized).toContain('data-noteit-inlined="https://example.org/css/site.css"')
    expect(sanitized).toContain('body { font: 16px serif; }')
    expect(sanitized).toContain('url(data:image/gif;base64,AAAA)')
    expect(sanitized).not.toMatch(/@import/i)
    expect(sanitized).not.toContain('cdn.example.org')
  })

  it('removes link, base, refresh, noscript and comments', () => {
    expect(sanitized).not.toMatch(/<link\b/i)
    expect(sanitized).not.toMatch(/<base\b/i)
    expect(sanitized).not.toMatch(/http-equiv/i)
    expect(sanitized).not.toMatch(/<noscript/i)
    expect(sanitized).not.toContain('<!--')
  })

  it('replaces external media with inert placeholders', () => {
    expect(sanitized).toMatch(/<img src="data:image\/gif;base64,[^"]+" alt="A">/)
    expect(sanitized).toContain('<iframe src="about:blank">')
    expect(sanitized).toContain('<video>')
    expect(sanitized).not.toContain('youtube.com')
  })

  it('redacts e-mail addresses and tracking links', () => {
    expect(sanitized).not.toContain('jane.doe@example.org')
    expect(sanitized).toContain('Contact redacted@example.com for details.')
    expect(sanitized).toContain('<a href="#">ad</a>')
  })

  it('reports no violations for the sanitized output and some for the raw input', () => {
    expect(findSanitizeViolations(sanitized)).toEqual([])
    expect(findSanitizeViolations(RAW).length).toBeGreaterThan(0)
  })
})

describe('sanitizeCss', () => {
  it('keeps data urls and fragments, neutralizes everything else', () => {
    expect(sanitizeCss('a{b:url("#f")} c{d:url(//x.org/y.png)} e{f:url(z.png)}')).toBe(
      'a{b:url("#f")} c{d:url("data:,")} e{f:url("data:,")}',
    )
  })
})

describe('committed corpus snapshots', () => {
  const snapshots = readdirSync(CORPUS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(CORPUS_DIR, d.name, 'page.html')))
    .map((d) => d.name)

  it('exist', () => {
    expect(snapshots.length).toBeGreaterThanOrEqual(5)
  })

  it.each(snapshots)('%s has no external scripts, tracking domains or external resources', (name) => {
    const html = readFileSync(join(CORPUS_DIR, name, 'page.html'), 'utf8')
    expect(findSanitizeViolations(html)).toEqual([])
  })
})
