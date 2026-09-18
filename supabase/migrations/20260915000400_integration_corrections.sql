create or replace function public.record_countdown_lifecycle()
returns trigger language plpgsql security definer set search_path = '' as $$
declare lifecycle_event text;
begin
  if tg_op = 'INSERT' then
    lifecycle_event := 'countdown_created';
  elsif old.state is distinct from new.state then
    lifecycle_event := 'countdown_' || new.state::text;
  else
    return new;
  end if;
  insert into public.activity_events(room_id, actor_id, event_type, subject_type, subject_id)
  values (new.room_id, auth.uid(), lifecycle_event, 'countdown', new.id);
  return new;
end;
$$;

create trigger countdown_lifecycle_activity
after insert or update of state on public.countdowns
for each row execute function public.record_countdown_lifecycle();

create or replace function public.create_room_with_invite(
  room_name text,
  room_admission_policy public.admission_policy default 'invite_only',
  room_guest_policy public.guest_policy default 'allow_guests',
  room_capacity integer default 10,
  allow_moderator_timer_control boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  created_room public.rooms;
  created_code text;
begin
  created_room := public.create_room(room_name, room_admission_policy, room_guest_policy, room_capacity, allow_moderator_timer_control);
  for invite_attempt in 1..5 loop
    created_code := upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 10));
    begin
      perform public.create_room_invite(created_room.id, created_code, null, least(50, greatest(1, created_room.capacity - 1)), null);
      exit;
    exception when unique_violation then
      if invite_attempt = 5 then raise; end if;
    end;
  end loop;
  return jsonb_build_object('room_id', created_room.id, 'invite_code', created_code);
end;
$$;

create or replace function public.create_and_start_countdown(
  target_scope public.timer_scope,
  countdown_name text,
  seconds integer,
  target_room_id uuid,
  policy public.timer_control_policy default 'creator_only',
  participant_ids uuid[] default '{}'
)
returns public.countdowns language plpgsql security definer set search_path = '' as $$
declare created_countdown public.countdowns;
begin
  created_countdown := public.create_countdown(target_scope, countdown_name, seconds, target_room_id, policy, participant_ids, null);
  return public.control_countdown(created_countdown.id, 'start');
end;
$$;

create or replace function public.finalize_elapsed_countdowns(target_room_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare finalized_count integer;
begin
  if not public.is_room_member(target_room_id) then
    raise exception 'room membership required' using errcode = '42501';
  end if;
  with finalized as (
    update public.countdowns
    set state = 'completed', scheduled_start_at = null, started_at = null, ends_at = null, paused_remaining_seconds = null
    where room_id = target_room_id
      and state in ('scheduled', 'running')
      and ends_at <= now()
    returning id
  )
  select count(*) into finalized_count from finalized;
  return finalized_count;
end;
$$;

revoke all on function public.create_room_with_invite(text, public.admission_policy, public.guest_policy, integer, boolean) from public, anon, authenticated;
revoke all on function public.create_and_start_countdown(public.timer_scope, text, integer, uuid, public.timer_control_policy, uuid[]) from public, anon, authenticated;
revoke all on function public.finalize_elapsed_countdowns(uuid) from public, anon, authenticated;
grant execute on function public.create_room_with_invite(text, public.admission_policy, public.guest_policy, integer, boolean) to authenticated;
grant execute on function public.create_and_start_countdown(public.timer_scope, text, integer, uuid, public.timer_control_policy, uuid[]) to authenticated;
grant execute on function public.finalize_elapsed_countdowns(uuid) to authenticated;
