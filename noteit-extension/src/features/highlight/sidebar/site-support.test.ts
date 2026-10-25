import { describe, expect, it } from 'vitest'
import { supportedSiteKey } from './site-support.ts'

describe('supportedSiteKey', () => {
  it('returns the site key of http(s) pages', () => {
    expect(supportedSiteKey('https://www.example.com/post?a=1')).toBe('example.com')
    expect(supportedSiteKey('http://127.0.0.1:5173/article.html')).toBe('127.0.0.1')
  })

  it('rejects chrome://, extension pages and PDF tabs', () => {
    expect(supportedSiteKey('chrome://extensions/')).toBeNull()
    expect(supportedSiteKey('chrome-extension://abc/src/entries/sidepanel/index.html')).toBeNull()
    expect(supportedSiteKey('https://example.com/paper.PDF')).toBeNull()
    expect(supportedSiteKey('not a url')).toBeNull()
  })
})
