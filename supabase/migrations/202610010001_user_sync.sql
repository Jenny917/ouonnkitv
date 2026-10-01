-- Run once in the Supabase SQL editor. Only authenticated users can access their own rows.
create table if not exists public.user_sync_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('favorite', 'history', 'preference')),
  item_key text not null check (length(item_key) between 1 and 2048),
  value jsonb,
  modified_at bigint not null check (modified_at >= 0),
  mutation_id text collate "C" not null,
  deleted boolean not null default false,
  primary key (user_id, kind, item_key)
);

alter table public.user_sync_records enable row level security;
create policy "Own sync rows" on public.user_sync_records
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on public.user_sync_records from public, anon, authenticated;
grant select, insert, update on public.user_sync_records to authenticated;

-- Atomic conflict resolution prevents a stale device overwriting newer records.
-- Retain tombstones so offline devices learn about deletions.
create or replace function public.sync_user_records(changes jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(changes) <> 'array' or jsonb_array_length(changes) > 100 then
    raise exception 'Expected at most 100 changes';
  end if;
  insert into public.user_sync_records as existing
    (user_id, kind, item_key, value, modified_at, mutation_id, deleted)
  select auth.uid(), r.kind, r.item_key, r.value, r.modified_at, r.mutation_id, r.deleted
  from jsonb_to_recordset(changes) as r(
    kind text, item_key text, value jsonb, modified_at bigint, mutation_id text, deleted boolean
  )
  on conflict (user_id, kind, item_key) do update set
    value = excluded.value, modified_at = excluded.modified_at,
    mutation_id = excluded.mutation_id, deleted = excluded.deleted
  where (excluded.modified_at, excluded.mutation_id collate "C") >
        (existing.modified_at, existing.mutation_id collate "C");
end;
$$;
revoke all on function public.sync_user_records(jsonb) from public, anon;
grant execute on function public.sync_user_records(jsonb) to authenticated;
