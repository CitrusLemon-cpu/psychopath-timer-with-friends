create or replace function public.enforce_immutable_profile_handle()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() = old.id
     and old.handle !~ '^user_[0-9a-f]{19}$'
     and new.handle is distinct from old.handle then
    raise exception 'handle cannot be changed' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger profiles_immutable_handle
before update of handle on public.profiles
for each row execute function public.enforce_immutable_profile_handle();

create or replace function public.can_edit_countdown(target_countdown_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.countdowns c
    where c.id = target_countdown_id
      and public.is_room_member(c.room_id, target_user_id)
      and (
        c.creator_id = target_user_id
        or (c.scope = 'shared' and exists (
          select 1
          from public.countdown_participants p
          where p.countdown_id = c.id and p.user_id = target_user_id
        ))
      )
  )
$$;

create function public.update_countdown(
  target_countdown_id uuid,
  target_scope public.timer_scope,
  countdown_name text,
  seconds integer,
  countdown_color text,
  policy public.timer_control_policy,
  participant_ids uuid[],
  scheduled_for timestamptz,
  start_immediately boolean
)
returns public.countdowns language plpgsql security definer set search_path = '' as $$
declare
  timer public.countdowns;
  participant uuid;
begin
  select * into timer from public.countdowns where id = target_countdown_id for update;
  if timer.id is null then
    raise exception 'countdown not found' using errcode = 'P0002';
  end if;
  if not public.can_edit_countdown(timer.id) then
    raise exception 'countdown edit denied' using errcode = '42501';
  end if;
  if target_scope <> timer.scope then
    raise exception 'countdown type cannot be changed' using errcode = '22023';
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

  delete from public.countdown_participants where countdown_id = timer.id;
  foreach participant in array coalesce(participant_ids, '{}'::uuid[]) loop
    if not public.is_room_member(timer.room_id, participant) then
      raise exception 'all participants must be room members' using errcode = '22023';
    end if;
    insert into public.countdown_participants(countdown_id, user_id, assigned_by)
    values (timer.id, participant, auth.uid()) on conflict do nothing;
  end loop;

  update public.countdowns
  set name = countdown_name,
      duration_seconds = seconds,
      color = countdown_color,
      control_policy = policy,
      state = case
        when scheduled_for is not null then 'scheduled'::public.timer_state
        when start_immediately then 'running'::public.timer_state
        else 'idle'::public.timer_state
      end,
      scheduled_start_at = scheduled_for,
      started_at = case when scheduled_for is null and start_immediately then now() end,
      ends_at = case
        when scheduled_for is not null then scheduled_for + make_interval(secs => seconds)
        when start_immediately then now() + make_interval(secs => seconds)
      end,
      paused_remaining_seconds = null
  where id = timer.id
  returning * into timer;

  return timer;
end;
$$;

revoke all on function public.can_edit_countdown(uuid, uuid) from public, anon, authenticated;
revoke all on function public.update_countdown(uuid, public.timer_scope, text, integer, text, public.timer_control_policy, uuid[], timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.can_edit_countdown(uuid, uuid) to authenticated;
grant execute on function public.update_countdown(uuid, public.timer_scope, text, integer, text, public.timer_control_policy, uuid[], timestamptz, boolean) to authenticated;
