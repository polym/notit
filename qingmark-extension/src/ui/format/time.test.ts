import { describe, expect, it } from 'vitest'
import { dateBucket, groupByDateBucket, startOfWeek, type DateBucket } from './time.ts'

// Local-time constructor so the table holds in any time zone.
const at = (y: number, m: number, d: number, h = 0, min = 0, ms = 0) => new Date(y, m - 1, d, h, min, 0, ms).getTime()

describe('ui/format/time dateBucket', () => {
  // Thursday 2026-10-22 15:00 local.
  const THU = at(2026, 10, 22, 15)
  const cases: Array<[string, number, number, DateBucket]> = [
    ['now', THU, THU, 'today'],
    ['today 00:00', at(2026, 10, 22), THU, 'today'],
    ['future (clock skew)', THU + 60_000, THU, 'today'],
    ['1ms before today 00:00', at(2026, 10, 22) - 1, THU, 'yesterday'],
    ['yesterday 00:00', at(2026, 10, 21), THU, 'yesterday'],
    ['1ms before yesterday 00:00', at(2026, 10, 21) - 1, THU, 'thisWeek'],
    ['week start Monday 00:00', at(2026, 10, 19), THU, 'thisWeek'],
    ['1ms before Monday 00:00', at(2026, 10, 19) - 1, THU, 'earlier'],
    ['last month', at(2026, 9, 1), THU, 'earlier'],
    // Monday: the week starts today, so nothing is "this week"; Sunday is yesterday.
    ['Monday now, Sunday noon', at(2026, 10, 18, 12), at(2026, 10, 19, 9), 'yesterday'],
    ['Monday now, Saturday', at(2026, 10, 17, 12), at(2026, 10, 19, 9), 'earlier'],
    // Tuesday: Monday is yesterday rather than this week.
    ['Tuesday now, Monday', at(2026, 10, 19, 8), at(2026, 10, 20, 9), 'yesterday'],
    // Sunday: the week started six days ago.
    ['Sunday now, Monday', at(2026, 10, 19, 8), at(2026, 10, 25, 23), 'thisWeek'],
    ['Sunday now, previous Sunday', at(2026, 10, 18, 23), at(2026, 10, 25, 23), 'earlier'],
  ]
  it.each(cases)('%s', (_name, ts, now, expected) => {
    expect(dateBucket(ts, now)).toBe(expected)
  })

  it('startOfWeek is local Monday 00:00', () => {
    expect(startOfWeek(at(2026, 10, 22, 15))).toBe(at(2026, 10, 19))
    expect(startOfWeek(at(2026, 10, 19))).toBe(at(2026, 10, 19))
    expect(startOfWeek(at(2026, 10, 25, 23, 59))).toBe(at(2026, 10, 19))
  })
})

describe('ui/format/time groupByDateBucket', () => {
  const NOW = at(2026, 10, 22, 15)
  it('keeps bucket order, input order inside a bucket, and drops empty buckets', () => {
    const items = [
      { id: 'a', ts: at(2026, 10, 22, 14) },
      { id: 'b', ts: at(2026, 9, 1) },
      { id: 'c', ts: at(2026, 10, 22, 9) },
      { id: 'd', ts: at(2026, 8, 1) },
    ]
    const groups = groupByDateBucket(items, (i) => i.ts, NOW)
    expect(groups.map((g) => [g.bucket, g.items.map((i) => i.id)])).toEqual([
      ['today', ['a', 'c']],
      ['earlier', ['b', 'd']],
    ])
  })

  it('returns no buckets for no items', () => {
    expect(groupByDateBucket([], () => 0, NOW)).toEqual([])
  })
})
