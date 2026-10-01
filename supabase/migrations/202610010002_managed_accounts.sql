-- Apply after 202610010001_user_sync.sql, using the Supabase SQL editor.
create table public.user_accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  role text not null default 'user' check (role in ('admin', 'user')),
  enabled boolean not null default true,
  sessions_valid_after timestamptz not null default '-infinity',
  created_at timestamptz not null default now()
);
alter table public.user_accounts enable row level security;
revoke all on public.user_accounts from public, anon, authenticated;
grant select on public.user_accounts to authenticated;
grant all on public.user_accounts to service_role;

-- Signup metadata supplied by clients cannot provision accounts or grant roles.
create function public.provision_managed_account()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.raw_app_meta_data ->> 'managed_account') is distinct from 'true' then
    raise exception 'Accounts must be created by an administrator';
  end if;
  insert into public.user_accounts(id, username, role)
  values (new.id, new.raw_app_meta_data ->> 'username',
          coalesce(new.raw_app_meta_data ->> 'account_role', 'user'));
  return new;
end;
$$;
revoke all on function public.provision_managed_account() from public, anon, authenticated;
create trigger provision_managed_account after insert on auth.users
for each row execute function public.provision_managed_account();

-- Checking the session's creation time (not token iat) prevents refresh of a
-- pre-reset session from restoring access. Disabled users are blocked immediately.
create function public.account_is_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_accounts a join auth.sessions s on s.user_id = a.id
    where a.id = (select auth.uid()) and a.enabled
      and s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and s.created_at > a.sessions_valid_after
  );
$$;
revoke all on function public.account_is_active() from public, anon;
grant execute on function public.account_is_active() to authenticated;
create policy "Read own active account" on public.user_accounts
for select to authenticated using (id = (select auth.uid()) and (select public.account_is_active()));

create function public.current_account()
returns table (id uuid, username text, role text, enabled boolean, created_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.username, a.role, a.enabled, a.created_at
  from public.user_accounts a where a.id = (select auth.uid());
$$;
revoke all on function public.current_account() from public, anon;
grant execute on function public.current_account() to authenticated;

drop policy "Own sync rows" on public.user_sync_records;
create policy "Own active account sync rows" on public.user_sync_records
for all to authenticated
using (user_id = (select auth.uid()) and (select public.account_is_active()))
with check (user_id = (select auth.uid()) and (select public.account_is_active()));

-- The API calls this before disabling/resetting users; the database clock is authoritative.
create function public.invalidate_account_sessions(target_id uuid, new_enabled boolean default null)
returns void language sql security invoker set search_path = '' as $$
  update public.user_accounts set sessions_valid_after = clock_timestamp(),
    enabled = coalesce(new_enabled, enabled) where id = target_id and role = 'user';
$$;
revoke all on function public.invalidate_account_sessions(uuid, boolean) from public, anon, authenticated;
grant execute on function public.invalidate_account_sessions(uuid, boolean) to service_role;
