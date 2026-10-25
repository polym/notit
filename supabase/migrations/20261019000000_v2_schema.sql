-- v2 schema (architecture.md "Supabase table public.highlights (new)", D9).
-- 1. The legacy table is renamed to highlights_legacy and kept unchanged as the rollback source.
-- 2. The new public.highlights is isolated per account by RLS (user_id = auth.uid()).
--    There is no delete policy: clients can only soft delete (deleted_at), never hard delete.
-- sync_push (D2) is added by a later migration.

alter table public.highlights rename to highlights_legacy;
alter index public.idx_highlights_url rename to idx_highlights_legacy_url;
alter index public.idx_highlights_timestamp rename to idx_highlights_legacy_timestamp;

-- The legacy table has no user_id and no RLS, so client roles lose all access to it.
-- Only the one-off migration script (service role) reads it.
revoke all on table public.highlights_legacy from anon, authenticated;

create table public.highlights (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id),
  canonical_url text not null,
  site_key text not null,
  url text not null,
  text text not null,
  color text not null check (color in ('yellow', 'orange', 'blue', 'green')),
  comment text,
  anchor jsonb,
  page_title text,
  favicon text,
  created_at bigint not null,
  edited_at bigint not null,
  device_id text not null,
  deleted_at bigint,
  server_seq bigint not null, -- set by sync_push, cursor for pull (D3)
  server_updated_at timestamptz not null default now() -- diagnostics only
);

create index highlights_user_id_server_seq_idx on public.highlights (user_id, server_seq);

alter table public.highlights enable row level security;

create policy hl_select on public.highlights for select to authenticated
  using (user_id = auth.uid());
create policy hl_insert on public.highlights for insert to authenticated
  with check (user_id = auth.uid());
create policy hl_update on public.highlights for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- No delete policy: a client delete matches 0 rows (soft delete only).

-- Anonymous requests get no table access at all; signed-in users go through RLS.
revoke all on table public.highlights from anon, authenticated;
grant select, insert, update, delete on table public.highlights to authenticated;

create sequence public.highlights_seq;
revoke all on sequence public.highlights_seq from anon, authenticated;
grant usage on sequence public.highlights_seq to authenticated;
