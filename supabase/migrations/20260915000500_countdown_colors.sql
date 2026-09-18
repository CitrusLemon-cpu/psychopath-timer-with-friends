alter table public.countdowns
add column color text not null default '#54d6d2',
add constraint countdowns_color_format check (color ~ '^#[0-9A-Fa-f]{6}$');

drop function public.create_and_start_countdown(public.timer_scope, text, integer, uuid, public.timer_control_policy, uuid[]);
drop function public.create_countdown(public.timer_scope, text, integer, uuid, public.timer_control_policy, uuid[], timestamptz);

create function public.create_countdown(
  target_scope public.timer_scope,
  countdown_name text,
  seconds integer,
  target_room_id uuid,
  policy public.timer_control_policy default 'creator_only',
  participant_ids uuid[] default '{}',
  scheduled_for timestamptz default null,
  countdown_color text default '#54d6d2'
)
returns public.countdowns language plpgsql security definer set search_path = '' as $$
declare created_countdown public.countdowns; participant uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if target_room_id is null or not public.is_room_member(target_room_id) then
    raise exception 'room membership required' using errcode = '42501';
  end if;
  if target_scope = 'shared' and public.current_user_is_anonymous() then
    raise exception 'anonymous guests cannot create shared timers' using errcode = '42501';
  end if;
  if target_scope = 'shared' and coalesce(cardinality(participant_ids), 0) = 0 then
    raise exception 'shared timers require at least one participant' using errcode = '22023';
  end if;
  if target_scope = 'personal' and coalesce(cardinality(participant_ids), 0) <> 0 then
    raise exception 'personal timers cannot have participants' using errcode = '22023';
  end if;
  if scheduled_for is not null and scheduled_for <= now() then
    raise exception 'scheduled start must be in the future' using errcode = '22023';
  end if;
  insert into public.countdowns(scope, room_id, owner_user_id, creator_id, name, duration_seconds, control_policy, state, scheduled_start_at, ends_at, color)
  values (target_scope, target_room_id, case when target_scope = 'personal' then auth.uid() end, auth.uid(), countdown_name, seconds, policy,
    case when scheduled_for is null then 'idle'::public.timer_state else 'scheduled'::public.timer_state end,
    scheduled_for, case when scheduled_for is not null then scheduled_for + make_interval(secs => seconds) end, countdown_color)
  returning * into created_countdown;
  foreach participant in array participant_ids loop
    if target_scope <> 'shared' or not public.is_room_member(target_room_id, participant) then
      raise exception 'all participants must be room members' using errcode = '22023';
    end if;
    insert into public.countdown_participants(countdown_id, user_id, assigned_by)
    values (created_countdown.id, participant, auth.uid()) on conflict do nothing;
  end loop;
  return created_countdown;
end;
$$;

create function public.create_and_start_countdown(
  target_scope public.timer_scope,
  countdown_name text,
  seconds integer,
  target_room_id uuid,
  policy public.timer_control_policy default 'creator_only',
  participant_ids uuid[] default '{}',
  countdown_color text default '#54d6d2'
)
returns public.countdowns language plpgsql security definer set search_path = '' as $$
declare created_countdown public.countdowns;
begin
  created_countdown := public.create_countdown(target_scope, countdown_name, seconds, target_room_id, policy, participant_ids, null, countdown_color);
  return public.control_countdown(created_countdown.id, 'start');
end;
$$;

revoke all on function public.create_countdown(public.timer_scope, text, integer, uuid, public.timer_control_policy, uuid[], timestamptz, text) from public, anon, authenticated;
revoke all on function public.create_and_start_countdown(public.timer_scope, text, integer, uuid, public.timer_control_policy, uuid[], text) from public, anon, authenticated;
grant execute on function public.create_countdown(public.timer_scope, text, integer, uuid, public.timer_control_policy, uuid[], timestamptz, text) to authenticated;
grant execute on function public.create_and_start_countdown(public.timer_scope, text, integer, uuid, public.timer_control_policy, uuid[], text) to authenticated;
