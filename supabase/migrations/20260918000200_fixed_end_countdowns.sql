alter table public.countdowns
add column fixed_end boolean not null default false;

create function public.reject_fixed_end_pause()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.fixed_end and new.state = 'paused' then
    raise exception 'fixed-end countdown cannot be paused' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger countdowns_reject_fixed_end_pause
before insert or update of state, fixed_end on public.countdowns
for each row execute function public.reject_fixed_end_pause();

create function public.create_countdown_v2(
  target_scope public.timer_scope,
  countdown_name text,
  seconds integer,
  target_room_id uuid,
  policy public.timer_control_policy,
  participant_ids uuid[],
  scheduled_for timestamptz,
  countdown_color text,
  fixed_end boolean
)
returns public.countdowns language plpgsql security definer set search_path = '' as $$
declare timer public.countdowns;
begin
  timer := public.create_countdown(target_scope, countdown_name, seconds, target_room_id, policy, participant_ids, scheduled_for, countdown_color);
  update public.countdowns set fixed_end = create_countdown_v2.fixed_end where id = timer.id returning * into timer;
  return timer;
end;
$$;

create function public.create_and_start_countdown_v2(
  target_scope public.timer_scope,
  countdown_name text,
  seconds integer,
  target_room_id uuid,
  policy public.timer_control_policy,
  participant_ids uuid[],
  countdown_color text,
  fixed_end boolean
)
returns public.countdowns language plpgsql security definer set search_path = '' as $$
declare timer public.countdowns;
begin
  timer := public.create_countdown_v2(target_scope, countdown_name, seconds, target_room_id, policy, participant_ids, null, countdown_color, fixed_end);
  return public.control_countdown(timer.id, 'start');
end;
$$;

create function public.update_countdown_v2(
  target_countdown_id uuid,
  target_scope public.timer_scope,
  countdown_name text,
  seconds integer,
  countdown_color text,
  policy public.timer_control_policy,
  participant_ids uuid[],
  scheduled_for timestamptz,
  start_immediately boolean,
  fixed_end boolean
)
returns public.countdowns language plpgsql security definer set search_path = '' as $$
declare timer public.countdowns;
begin
  timer := public.update_countdown(target_countdown_id, target_scope, countdown_name, seconds, countdown_color, policy, participant_ids, scheduled_for, start_immediately);
  update public.countdowns set fixed_end = update_countdown_v2.fixed_end where id = timer.id returning * into timer;
  return timer;
end;
$$;

revoke all on function public.create_countdown_v2(public.timer_scope, text, integer, uuid, public.timer_control_policy, uuid[], timestamptz, text, boolean) from public, anon, authenticated;
revoke all on function public.create_and_start_countdown_v2(public.timer_scope, text, integer, uuid, public.timer_control_policy, uuid[], text, boolean) from public, anon, authenticated;
revoke all on function public.update_countdown_v2(uuid, public.timer_scope, text, integer, text, public.timer_control_policy, uuid[], timestamptz, boolean, boolean) from public, anon, authenticated;
grant execute on function public.create_countdown_v2(public.timer_scope, text, integer, uuid, public.timer_control_policy, uuid[], timestamptz, text, boolean) to authenticated;
grant execute on function public.create_and_start_countdown_v2(public.timer_scope, text, integer, uuid, public.timer_control_policy, uuid[], text, boolean) to authenticated;
grant execute on function public.update_countdown_v2(uuid, public.timer_scope, text, integer, text, public.timer_control_policy, uuid[], timestamptz, boolean, boolean) to authenticated;
