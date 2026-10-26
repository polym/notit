-- Legacy schema: replicates the live public.highlights table as defined in
-- supabase/legacy/complete-schema.sql (column set, types and indexes).
-- The live table has no user_id, no updated_at and no RLS; it is reproduced as-is so that
-- the v2 migration (rename to highlights_legacy, new table, RLS) can be rehearsed locally.
create table if not exists public.highlights (
  id text primary key,
  text text not null,
  url text not null,
  color text not null,
  timestamp bigint not null,
  "pageTitle" text,
  favicon text,
  comment text,
  start integer,
  length integer,
  context jsonb,
  xpath text,
  created_at timestamp with time zone default now()
);

create index if not exists idx_highlights_url on public.highlights (url);
create index if not exists idx_highlights_timestamp on public.highlights (timestamp desc);

-- Same exposure as the live project: anon and authenticated roles can use the table via PostgREST.
grant select, insert, update, delete on table public.highlights to anon, authenticated;
