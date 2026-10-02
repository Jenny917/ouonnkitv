-- Apply after the managed-account migrations. One renewable playback lease per account.
begin;

create table if not exists public.account_playback (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_id uuid not null,
  player_id uuid not null,
  lease_id uuid not null,
  device_label text not null,
  media_key text not null,
  title text not null,
  position double precision not null default 0,
  duration double precision not null default 0,
  expires_at timestamptz not null
);
alter table public.account_playback enable row level security;
revoke all on public.account_playback from public, anon, authenticated;
grant all on public.account_playback to service_role;

-- Recreate only the RPC so reruns also support previously named parameters.
drop function if exists public.playback_lease(text, uuid, uuid, uuid, text, text, text, double precision, double precision);
create function public.playback_lease(
  p_operation text,
  p_player uuid,
  p_lease uuid default null,
  p_takeover uuid default null,
  p_device_label text default '',
  p_media_key text default '',
  p_title text default '',
  p_position double precision default null,
  p_duration double precision default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  previous public.account_playback%rowtype;
  lease_clock timestamptz;
  next_lease uuid;
  resume_position double precision := null;
begin
  if not public.account_is_active() or sid is null then raise exception 'Inactive account'; end if;
  if p_player is null or p_operation is null or p_operation not in ('acquire', 'renew', 'release') then
    raise exception 'Invalid playback operation';
  end if;
  if p_position is not null and not (p_position >= 0 and p_position < 1000000000) then
    raise exception 'Invalid position';
  end if;
  if p_duration is not null and not (p_duration >= 0 and p_duration < 1000000000) then
    raise exception 'Invalid duration';
  end if;
  -- Serialize even first-time claims; the lease row might not exist yet.
  perform 1 from public.user_accounts a where a.id = uid for update;
  lease_clock := clock_timestamp();
  select * into previous from public.account_playback p where p.user_id = uid for update;

  if p_operation = 'acquire' then
    if length(p_media_key) not between 1 and 2048 then raise exception 'Invalid media key'; end if;
    if previous.user_id is not null and previous.expires_at > lease_clock
       and not (previous.player_id = p_player and previous.session_id = sid)
       and p_takeover is distinct from previous.lease_id then
      return jsonb_build_object('status', 'busy', 'lease_id', previous.lease_id,
        'device_label', previous.device_label, 'title', previous.title);
    end if;
    if previous.media_key = p_media_key and previous.player_id <> p_player then
      resume_position := previous.position;
    end if;
    next_lease := case when previous.player_id = p_player and previous.session_id = sid
      and previous.expires_at > lease_clock then previous.lease_id else gen_random_uuid() end;
    insert into public.account_playback as p
      (user_id, session_id, player_id, lease_id, device_label, media_key, title, position, duration, expires_at)
    values (uid, sid, p_player, next_lease, left(p_device_label, 160), p_media_key, left(p_title, 300),
      coalesce(resume_position, p_position, 0), coalesce(p_duration, 0), lease_clock + interval '30 seconds')
    on conflict (user_id) do update set session_id = excluded.session_id,
      player_id = excluded.player_id, lease_id = excluded.lease_id,
      device_label = excluded.device_label, media_key = excluded.media_key, title = excluded.title,
      position = excluded.position, duration = excluded.duration, expires_at = excluded.expires_at;
    return jsonb_build_object('status', 'held', 'lease_id', next_lease,
      'resume_position', resume_position, 'ttl_ms', 30000);
  end if;

  if previous.player_id is distinct from p_player or previous.session_id is distinct from sid
     or previous.lease_id is distinct from p_lease or previous.expires_at <= lease_clock then
    return jsonb_build_object('status', 'lost');
  end if;
  update public.account_playback p set
    position = coalesce(p_position, p.position),
    duration = coalesce(p_duration, p.duration),
    expires_at = case when p_operation = 'release' then lease_clock else lease_clock + interval '30 seconds' end
  where p.user_id = uid;
  return jsonb_build_object('status', case when p_operation = 'release' then 'released' else 'held' end,
    'lease_id', previous.lease_id, 'ttl_ms', 30000);
end;
$$;
revoke all on function public.playback_lease(text, uuid, uuid, uuid, text, text, text, double precision, double precision) from public, anon;
grant execute on function public.playback_lease(text, uuid, uuid, uuid, text, text, text, double precision, double precision) to authenticated;

-- Fence delayed progress from a replaced player, including updates queued while offline.
-- The row lock prevents a takeover racing a progress write in the same transaction.
create or replace function public.guard_playback_progress()
returns trigger language plpgsql security definer set search_path = '' as $$
declare current_lease public.account_playback%rowtype;
begin
  if new.kind <> 'history' or new.deleted or not (new.value ? 'playbackLeaseId') then return new; end if;
  select * into current_lease from public.account_playback p where p.user_id = new.user_id for share;
  if current_lease.lease_id::text is distinct from new.value ->> 'playbackLeaseId'
     or current_lease.session_id::text is distinct from auth.jwt() ->> 'session_id'
     or current_lease.media_key is distinct from new.item_key then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_playback_progress() from public, anon, authenticated;
drop trigger if exists guard_playback_progress on public.user_sync_records;
create trigger guard_playback_progress before insert or update on public.user_sync_records
for each row execute function public.guard_playback_progress();

-- A new authorized player wins over the previous player's clock, even if it was ahead.
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
        (existing.modified_at, existing.mutation_id collate "C")
     or (excluded.kind = 'history' and not excluded.deleted
         and excluded.value ? 'playbackLeaseId'
         and (excluded.value ->> 'playbackLeaseId') is distinct from (existing.value ->> 'playbackLeaseId'));
end;
$$;

commit;
