alter table public.user_accounts
  add column if not exists allow_nsfw boolean not null default false;

drop function if exists public.current_account();
create function public.current_account()
returns table (
  id uuid,
  username text,
  role text,
  enabled boolean,
  allow_nsfw boolean,
  created_at timestamptz
)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.username, a.role, a.enabled, a.allow_nsfw, a.created_at
  from public.user_accounts a where a.id = (select auth.uid());
$$;
revoke all on function public.current_account() from public, anon;
grant execute on function public.current_account() to authenticated;

create or replace function public.set_account_nsfw(target_id uuid, new_allow_nsfw boolean)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.user_accounts
  set allow_nsfw = new_allow_nsfw, sessions_valid_after = clock_timestamp()
  where id = target_id and role = 'user';
  delete from public.account_devices where user_id = target_id;
end;
$$;
revoke all on function public.set_account_nsfw(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_account_nsfw(uuid, boolean) to service_role;

alter table public.admin_audit_log
  drop constraint if exists admin_audit_log_action_check;
alter table public.admin_audit_log
  add constraint admin_audit_log_action_check check (action in (
    'create', 'set_enabled', 'set_nsfw', 'reset_password', 'force_logout', 'delete'
  ));
