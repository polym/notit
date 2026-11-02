import { describe, expect, it } from 'vitest'
import { TRACKING_PARAMS, canonicalUrl, siteKey } from './index.ts'

describe('canonicalUrl', () => {
  // EXPERIENCE.md "Page and site identity", first table.
  it.each([
    ['https://example.com/post?id=3#intro', 'https://example.com/post?id=3'],
    ['https://example.com/post?utm_source=x&id=3', 'https://example.com/post?id=3'],
    ['https://example.com/post?fbclid=abc', 'https://example.com/post'],
  ])('EXPERIENCE example %s', (input, expected) => {
    expect(canonicalUrl(input)).toBe(expected)
  })

  it.each([
    ['keeps query order', 'https://example.com/a?b=2&a=1&c=3', 'https://example.com/a?b=2&a=1&c=3'],
    [
      'keeps order around removed params',
      'https://example.com/a?z=1&utm_medium=m&y=2&gclid=g&x=3',
      'https://example.com/a?z=1&y=2&x=3',
    ],
    ['drops empty query', 'https://example.com/a?', 'https://example.com/a'],
    ['drops query of only tracking params', 'https://example.com/a?utm_source=x&spm=1.2#h', 'https://example.com/a'],
    ['drops stray separators', 'https://example.com/a?&id=3&&', 'https://example.com/a?id=3'],
    ['lowercases host', 'https://Example.COM/Post?ID=3', 'https://example.com/Post?ID=3'],
    ['keeps path case and trailing slash', 'https://example.com/A/', 'https://example.com/A/'],
    ['adds root path', 'https://example.com', 'https://example.com/'],
    ['keeps non-default port', 'http://localhost:8080/x?y=1', 'http://localhost:8080/x?y=1'],
    ['drops default port', 'https://example.com:443/x', 'https://example.com/x'],
    ['keeps encoding of other params', 'https://example.com/s?q=a%20b+c&utm_term=t', 'https://example.com/s?q=a%20b+c'],
    ['matches tracking names case-insensitively', 'https://example.com/a?UTM_Source=x&FBCLID=1&id=3', 'https://example.com/a?id=3'],
    ['keeps params that only contain a tracking name', 'https://example.com/a?my_utm=1&spmx=2', 'https://example.com/a?my_utm=1&spmx=2'],
    ['keeps www in page identity', 'https://www.example.com/a', 'https://www.example.com/a'],
  ])('%s', (_name, input, expected) => {
    expect(canonicalUrl(input)).toBe(expected)
  })

  it('removes every listed tracking param', () => {
    const names = TRACKING_PARAMS.map((p) => (p.endsWith('*') ? `${p.slice(0, -1)}campaign` : p))
    const query = names.map((n) => `${n}=v`).join('&')
    expect(canonicalUrl(`https://example.com/p?${query}&id=1`)).toBe('https://example.com/p?id=1')
  })

  it.each(['chrome://extensions', 'file:///tmp/a.html', 'about:blank', 'chrome-extension://abc/x.html', 'not a url', ''])(
    'returns null for %s',
    (input) => {
      expect(canonicalUrl(input)).toBeNull()
    },
  )
})

describe('siteKey', () => {
  // EXPERIENCE.md "Page and site identity", second table.
  it.each([
    ['https://www.example.com/a', 'example.com'],
    ['https://example.com/a', 'example.com'],
    ['https://docs.example.com/a', 'docs.example.com'],
  ])('EXPERIENCE example %s', (input, expected) => {
    expect(siteKey(input)).toBe(expected)
  })

  it('treats docs subdomain as a different site', () => {
    expect(siteKey('https://docs.example.com/')).not.toBe(siteKey('https://example.com/'))
  })

  it.each([
    ['lowercases host', 'https://WWW.Example.COM/a', 'example.com'],
    ['ignores port, path, query and hash', 'http://www.example.com:8080/a?b=1#c', 'example.com'],
    ['removes only a leading www.', 'https://www.www.example.com/', 'www.example.com'],
    ['keeps www inside the host', 'https://wwwexample.com/', 'wwwexample.com'],
    ['keeps www2', 'https://www2.example.com/', 'www2.example.com'],
  ])('%s', (_name, input, expected) => {
    expect(siteKey(input)).toBe(expected)
  })

  it.each(['chrome://newtab', 'file:///tmp/a.html', 'about:blank', 'not a url'])('returns null for %s', (input) => {
    expect(siteKey(input)).toBeNull()
  })
})
