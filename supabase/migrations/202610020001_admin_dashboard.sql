create table if not exists public.account_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  label text not null check (length(label) between 1 and 160),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, session_id)
);
alter table public.account_devices enable row level security;
revoke all on public.account_devices from public, anon, authenticated;
grant all on public.account_devices to service_role;

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_username text not null,
  target_id uuid,
  target_username text,
  action text not null check (action in (
    'create', 'set_enabled', 'reset_password', 'force_logout', 'delete'
  )),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated;
grant select, insert on public.admin_audit_log to service_role;
create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log (created_at desc, id desc);

create or replace function public.touch_account_activity(device_label text)
returns void language plpgsql security definer set search_path = '' as $$
declare session_uuid uuid;
begin
  if not public.account_is_active() then raise exception 'Inactive account'; end if;
  session_uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  if session_uuid is null then raise exception 'Session required'; end if;
  insert into public.account_devices(user_id, session_id, label)
  values (auth.uid(), session_uuid, left(coalesce(nullif(device_label, ''), 'Unknown device'), 160))
  on conflict (user_id, session_id) do update set
    label = excluded.label, last_seen_at = clock_timestamp();
end;
$$;
revoke all on function public.touch_account_activity(text) from public, anon;
grant execute on function public.touch_account_activity(text) to authenticated;

-- Session invalidation also removes the dashboard's now-stale device rows.
create or replace function public.invalidate_account_sessions(target_id uuid, new_enabled boolean default null)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.user_accounts set sessions_valid_after = clock_timestamp(),
    enabled = coalesce(new_enabled, enabled) where id = target_id and role = 'user';
  delete from public.account_devices where user_id = target_id;
end;
$$;
