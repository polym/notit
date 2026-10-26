import { describe, expect, it } from 'vitest'
import type { HighlightRecord } from '../../../core/model/index.ts'
import { groupAllSites, pageGroups } from './page-groups.ts'

const at = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime()
// Thursday 2026-10-22 15:00 local.
const NOW = at(2026, 10, 22, 15)

function rec(id: string, canonicalUrl: string, createdAt: number, overrides: Partial<HighlightRecord> = {}): HighlightRecord {
  return {
    id,
    userId: 'u',
    canonicalUrl,
    siteKey: new URL(canonicalUrl).hostname,
    url: canonicalUrl,
    text: id,
    color: 'yellow',
    comment: null,
    anchor: null,
    pageTitle: null,
    favicon: null,
    createdAt,
    editedAt: createdAt,
    deletedAt: null,
    deviceId: 'd',
    schemaVersion: 1,
    ...overrides,
  }
}

const anchor = (start: number) => ({ start, end: start + 1, exact: 'x', prefix: '', suffix: '' })

describe('page-groups', () => {
  it('puts a whole page group in the bucket of its newest highlight, never split', () => {
    const rows = [
      rec('a-old', 'https://a.example/p', at(2026, 9, 1)),
      rec('a-new', 'https://a.example/p', at(2026, 10, 22, 10)),
      rec('b', 'https://b.example/p', at(2026, 10, 21, 9)),
      rec('c', 'https://c.example/p', at(2026, 8, 1)),
    ]
    const buckets = groupAllSites(rows, NOW)
    expect(buckets.map((b) => [b.bucket, b.groups.map((g) => g.key)])).toEqual([
      ['today', ['https://a.example/p']],
      ['yesterday', ['https://b.example/p']],
      ['earlier', ['https://c.example/p']],
    ])
    expect(buckets[0].groups[0].highlights.map((h) => h.id).sort()).toEqual(['a-new', 'a-old'])
  })

  it('leaves out empty buckets', () => {
    const buckets = groupAllSites([rec('a', 'https://a.example/p', at(2026, 10, 20, 9))], NOW)
    expect(buckets.map((b) => b.bucket)).toEqual(['thisWeek'])
    expect(groupAllSites([], NOW)).toEqual([])
  })

  it('orders groups newest first and items in article order', () => {
    const rows = [
      rec('late', 'https://a.example/p', 30, { anchor: anchor(500) }),
      rec('early', 'https://a.example/p', 40, { anchor: anchor(10) }),
      rec('nopos', 'https://a.example/p', 10),
      rec('other', 'https://b.example/p', 20),
    ]
    const groups = pageGroups(rows)
    expect(groups.map((g) => g.key)).toEqual(['https://a.example/p', 'https://b.example/p'])
    expect(groups[0].highlights.map((h) => h.id)).toEqual(['early', 'late', 'nopos'])
    expect(groups[0].latest).toBe(40)
  })

  it('takes title and favicon from the newest item that has one, else the host name', () => {
    const groups = pageGroups([
      rec('1', 'https://a.example/p', 1, { pageTitle: 'Old title', favicon: 'https://a.example/old.ico' }),
      rec('2', 'https://a.example/p', 2, { pageTitle: 'New title' }),
      rec('3', 'https://b.example/q', 3),
    ])
    expect(groups.find((g) => g.key === 'https://a.example/p')).toMatchObject({
      title: 'New title',
      favicon: 'https://a.example/old.ico',
    })
    expect(groups.find((g) => g.key === 'https://b.example/q')).toMatchObject({ title: 'b.example', favicon: null })
  })

  it('groups x.com timeline highlights under one /home page', () => {
    const groups = pageGroups([
      rec('t1', 'https://x.com/home', 1),
      rec('t2', 'https://x.com/home', 2),
      rec('t3', 'https://x.com/home', 3),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].highlights).toHaveLength(3)
  })
})
