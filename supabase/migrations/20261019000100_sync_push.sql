-- sync_push RPC (architecture.md D2, D3).
-- The only client write path into public.highlights. For every incoming row:
--   * unknown id -> insert;
--   * (edited_at, device_id) strictly greater than the stored row -> update (a delete is just an edit);
--   * otherwise the stored row is kept unchanged.
-- Every written row gets a fresh server_seq from highlights_seq (pull cursor).
-- Returns {now_ms, rows}: rows holds the currently stored row of every incoming id,
-- whether or not it was accepted. An empty array only returns now_ms (and rows = []).
--
-- security invoker: RLS still applies. A per-user advisory transaction lock serialises the
-- user's write transactions, so server_seq values commit in allocation order and a pull with
-- `server_seq > cursor` never skips a row that commits later with a smaller number.
--
-- device_id is compared with collate "C" (byte order), matching the client comparison in
-- core/sync/merge.ts#wins for ASCII device ids.

create or replace function public.sync_push(rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  incoming jsonb;
  new_edited_at bigint;
  new_device_id text;
  stored public.highlights%rowtype;
  ids text[] := '{}';
  result_rows jsonb;
begin
  if uid is null then
    raise exception 'sync_push requires an authenticated user' using errcode = '42501';
  end if;
  if rows is null or jsonb_typeof(rows) <> 'array' then
    raise exception 'sync_push expects a json array' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  for incoming in select value from jsonb_array_elements(rows) loop
    new_edited_at := (incoming ->> 'edited_at')::bigint;
    new_device_id := incoming ->> 'device_id';
    ids := array_append(ids, incoming ->> 'id');

    select * into stored from public.highlights h where h.id = incoming ->> 'id' for update;

    if not found then
      -- An id owned by another account is invisible under RLS; the insert then fails on the
      -- primary key, which aborts the whole call instead of touching the other row.
      insert into public.highlights (
        id, user_id, canonical_url, site_key, url, text, color, comment, anchor,
        page_title, favicon, created_at, edited_at, device_id, deleted_at, server_seq
      ) values (
        incoming ->> 'id',
        uid,
        incoming ->> 'canonical_url',
        incoming ->> 'site_key',
        incoming ->> 'url',
        incoming ->> 'text',
        incoming ->> 'color',
        incoming ->> 'comment',
        nullif(incoming -> 'anchor', 'null'::jsonb),
        incoming ->> 'page_title',
        incoming ->> 'favicon',
        (incoming ->> 'created_at')::bigint,
        new_edited_at,
        new_device_id,
        (incoming ->> 'deleted_at')::bigint,
        nextval('public.highlights_seq')
      );
    elsif (new_edited_at, new_device_id collate "C") > (stored.edited_at, stored.device_id collate "C") then
      update public.highlights h set
        canonical_url = incoming ->> 'canonical_url',
        site_key = incoming ->> 'site_key',
        url = incoming ->> 'url',
        text = incoming ->> 'text',
        color = incoming ->> 'color',
        comment = incoming ->> 'comment',
        anchor = nullif(incoming -> 'anchor', 'null'::jsonb),
        page_title = incoming ->> 'page_title',
        favicon = incoming ->> 'favicon',
        created_at = (incoming ->> 'created_at')::bigint,
        edited_at = new_edited_at,
        device_id = new_device_id,
        deleted_at = (incoming ->> 'deleted_at')::bigint,
        server_seq = nextval('public.highlights_seq'),
        server_updated_at = now()
      where h.id = stored.id;
    end if;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(h) order by h.server_seq), '[]'::jsonb)
    into result_rows
    from public.highlights h
    where h.id = any (ids);

  return jsonb_build_object(
    'now_ms', (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'rows', result_rows
  );
end;
$$;

revoke all on function public.sync_push(jsonb) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;
