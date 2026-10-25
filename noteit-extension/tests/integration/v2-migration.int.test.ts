// Rehearses the v2 migration on legacy fixtures (Story 2.12): highlights_legacy must keep every
// row unchanged. `supabase db reset` runs migrations before seed data, so the rehearsal replays
// both migration files in a scratch schema inside one transaction that is rolled back.
// Prerequisite: `npm run db:start && npm run db:reset`.
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runLocalSql, supabasePath } from '../helpers/local-supabase.ts'

const SCHEMA = 'v2_rehearsal'

function migration(suffix: string): string {
  const file = readdirSync(supabasePath('migrations')).find((name) => name.endsWith(suffix))
  if (!file) throw new Error(`migration *${suffix} not found`)
  // Every object in the migrations is schema-qualified as public.<name>.
  return readFileSync(supabasePath('migrations', file), 'utf8').replaceAll('public.', `${SCHEMA}.`)
}

// Legacy fixtures: nulls, jsonb context, hex / rgb() / unknown colors, unicode and quotes.
const LEGACY_FIXTURES = `
insert into ${SCHEMA}.highlights (id, text, url, color, timestamp, "pageTitle", favicon, comment, start, length, context, xpath) values
  ('legacy-1', 'Plain text', 'https://example.com/a', '#ffeb3b', 1700000000001, 'Title A', 'https://example.com/favicon.ico', null, 10, 10, '{"prefix":"before ","suffix":" after"}', '/html/body/p[1]'),
  ('legacy-2', 'Café naïve with ''quotes''', 'https://example.com/b?utm_source=x#h', 'rgb(255, 235, 59)', 1700000000002, null, null, 'a comment', null, null, null, null),
  ('legacy-3', 'Unknown color', 'https://example.org/c', '#123456', 1700000000003, 'Title C', null, '', 0, 13, '{}', null),
  ('legacy-4', 'Line one
line two', 'https://example.org/d', '#4caf50', 1700000000004, 'Title D', null, null, 5, 8, '{"prefix":"","suffix":""}', '/html/body/div[2]'),
  ('legacy-5', 'Blue', 'https://example.net/e', '#2196f3', 1700000000005, null, null, 'emoji 🙂', 1, 4, null, null);
`

const FINGERPRINT = (table: string) =>
  `select count(*) || ':' || md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from ${SCHEMA}.${table} t;`

describe('v2 migration rehearsal', () => {
  it('keeps every legacy row unchanged in highlights_legacy', () => {
    const output = runLocalSql(`
      begin;
      create schema ${SCHEMA};
      ${migration('_legacy_highlights.sql')}
      ${LEGACY_FIXTURES}
      ${FINGERPRINT('highlights')}
      ${migration('_v2_schema.sql')}
      ${FINGERPRINT('highlights_legacy')}
      select count(*) from ${SCHEMA}.highlights;
      rollback;
    `)
    const [before, after, newTableCount] = output.trim().split('\n')
    expect(before).toMatch(/^5:[0-9a-f]{32}$/)
    expect(after).toBe(before)
    expect(newTableCount).toBe('0')
  })

  it('leaves the reset database with highlights_legacy and the v2 highlights table', () => {
    const output = runLocalSql(`
      select string_agg(column_name, ',' order by ordinal_position)
        from information_schema.columns where table_schema = 'public' and table_name = 'highlights_legacy';
      select relrowsecurity from pg_class where oid = 'public.highlights'::regclass;
      select count(*) from pg_policies where schemaname = 'public' and tablename = 'highlights' and cmd = 'DELETE';
      select has_sequence_privilege('authenticated', 'public.highlights_seq', 'usage');
    `)
    expect(output.trim().split('\n')).toEqual([
      'id,text,url,color,timestamp,pageTitle,favicon,comment,start,length,context,xpath,created_at',
      't',
      '0',
      't',
    ])
  })
})
