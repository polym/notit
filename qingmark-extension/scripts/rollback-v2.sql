-- Rollback of the v2 schema (architecture.md D9, Story 2.20).
-- Restores public.highlights to the state before supabase/migrations/20261019000000_v2_schema.sql:
-- the v2 table, its sequence and sync_push are dropped, and highlights_legacy (kept unchanged by
-- the v2 migration) is renamed back with its original index names and client grants.
--
-- DESTRUCTIVE: every row in the v2 public.highlights table is lost, including edits made after
-- the migration. Take a backup first (scripts/migrate-legacy.ts --backup only covers the legacy table).
--
-- Run as one transaction, e.g.:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f scripts/rollback-v2.sql
-- The script has no begin/commit of its own so callers can wrap it in a larger transaction.

drop function if exists public.sync_push(jsonb);
drop table public.highlights;
drop sequence if exists public.highlights_seq;

alter table public.highlights_legacy rename to highlights;
alter index public.idx_highlights_legacy_url rename to idx_highlights_url;
alter index public.idx_highlights_legacy_timestamp rename to idx_highlights_timestamp;

-- Same exposure as before v2 (supabase/migrations/20261018000000_legacy_highlights.sql plus the
-- schema default privileges), which the v2 migration revoked.
grant all on table public.highlights to anon, authenticated;

-- Forget the v2 migrations so the migration history matches the restored schema and a later
-- `supabase db push` applies them again.
delete from supabase_migrations.schema_migrations
where version in ('20261019000000', '20261019000100', '20261020000000');
