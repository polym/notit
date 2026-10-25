-- server_seq defaults to the next highlights_seq value (Story 2.20).
-- sync_push always sets server_seq explicitly; the default lets the one-off legacy migration
-- script (scripts/migrate-legacy.ts, service role over PostgREST) insert rows that draw from the
-- same sequence, so migrated rows are visible to the pull cursor like any other write.
alter table public.highlights alter column server_seq set default nextval('public.highlights_seq');
