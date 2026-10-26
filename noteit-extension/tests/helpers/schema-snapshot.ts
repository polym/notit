// Deterministic text description of the public schema (relations, columns, indexes, constraints,
// grants, policies, functions). Used to compare the schema after scripts/rollback-v2.sql with the
// committed M0 baseline (supabase/tests/fixtures/m0-schema.txt). OIDs and grantors are excluded.
//
// Regenerating the baseline (only when the legacy migration itself changes):
//   npm run db:reset -- --version 20261018000000
//   node -e "import('./tests/helpers/schema-snapshot.ts').then(m => m.writeBaseline())"
//   npm run db:reset
import { writeFileSync } from 'node:fs'
import { runLocalSql, supabasePath } from './local-supabase.ts'

export const M0_SCHEMA_BASELINE = supabasePath('tests', 'fixtures', 'm0-schema.txt')

/** SQL that prints one line per schema fact of `public`, sorted. */
export const DESCRIBE_PUBLIC_SQL = `
select line from (
  select 'relation ' || relname || ' kind=' || relkind::text || ' rls=' || relrowsecurity::text as line
    from pg_class where relnamespace = 'public'::regnamespace
  union all
  select 'column ' || table_name || '.' || column_name || ' ' || data_type || ' null=' || is_nullable
         || ' default=' || coalesce(column_default, '-')
    from information_schema.columns where table_schema = 'public'
  union all
  select 'index ' || indexname || ' ' || indexdef from pg_indexes where schemaname = 'public'
  union all
  select 'constraint ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace
  union all
  select 'grant ' || table_name || ' ' || grantee || ' ' || privilege_type
    from information_schema.role_table_grants where table_schema = 'public'
  union all
  select 'policy ' || tablename || ' ' || policyname || ' ' || cmd from pg_policies where schemaname = 'public'
  union all
  select 'function ' || proname from pg_proc where pronamespace = 'public'::regnamespace
) facts order by line;
`

/** Current description of the public schema (one fact per line). */
export function describePublicSchema(): string {
  return runLocalSql(DESCRIBE_PUBLIC_SQL)
}

/** Writes the current public schema description as the M0 baseline (see the header). */
export function writeBaseline(): void {
  writeFileSync(M0_SCHEMA_BASELINE, describePublicSchema())
}
