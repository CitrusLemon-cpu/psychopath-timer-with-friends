create or replace function public.current_user_is_anonymous()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
$$;

create or replace function public.is_room_member(target_room_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_memberships
    where room_id = target_room_id and user_id = target_user_id
  )
$$;

create or replace function public.has_room_role(target_room_id uuid, allowed_roles public.room_role[], target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_memberships
    where room_id = target_room_id and user_id = target_user_id and role = any(allowed_roles)
  )
$$;

create or replace function public.shares_room_with(target_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select target_user_id = auth.uid() or exists (
    select 1
    from public.room_memberships mine
    join public.room_memberships theirs using (room_id)
    where mine.user_id = auth.uid() and theirs.user_id = target_user_id
  )
$$;

create or replace function public.has_active_sanction(target_room_id uuid, target_user_id uuid, target_kind public.sanction_kind)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_sanctions
    where room_id = target_room_id
      and user_id = target_user_id
      and kind = target_kind
      and revoked_at is null
      and (expires_at is null or expires_at > now())
  )
$$;

create or replace function public.assert_room_capacity(target_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  member_count integer;
  member_limit integer;
begin
  select capacity into member_limit from public.rooms where id = target_room_id for update;
  if member_limit is null then raise exception 'room not found' using errcode = 'P0002'; end if;
  select count(*) into member_count from public.room_memberships where room_id = target_room_id;
  if member_count >= member_limit then raise exception 'room is at capacity' using errcode = 'P0001'; end if;
end;
$$;

create or replace function public.create_room(
  room_name text,
  room_admission_policy public.admission_policy default 'invite_only',
  room_guest_policy public.guest_policy default 'allow_guests',
  room_capacity integer default 10,
  allow_moderator_timer_control boolean default false
)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  created_room public.rooms;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if public.current_user_is_anonymous() then
    raise exception 'anonymous users cannot create rooms' using errcode = '42501';
  end if;

  insert into public.rooms(owner_id, name, admission_policy, guest_policy, capacity, moderators_can_control_timers)
  values (actor, room_name, room_admission_policy, room_guest_policy, room_capacity, allow_moderator_timer_control)
  returning * into created_room;

  insert into public.room_memberships(room_id, user_id, role) values (created_room.id, actor, 'owner');
  insert into public.room_ownership_history(room_id, new_owner_id, reason) values (created_room.id, actor, 'created');
  insert into public.activity_events(room_id, actor_id, event_type, subject_type, subject_id)
  values (created_room.id, actor, 'room_created', 'room', created_room.id);
  return created_room;
end;
$$;

create or replace function public.create_room_invite(
  target_room_id uuid,
  invite_code text,
  invite_role public.room_role default 'member',
  invite_granted_to uuid default null,
  invite_max_uses integer default 1,
  invite_expires_at timestamptz default null
)
returns public.room_invites language plpgsql security definer set search_path = '' as $$
declare created_invite public.room_invites;
begin
  if not public.has_room_role(target_room_id, array['owner','moderator']::public.room_role[]) then
    raise exception 'owner or moderator role required' using errcode = '42501';
  end if;
  insert into public.room_invites(room_id, code, created_by, granted_to, granted_role, max_uses, expires_at)
  values (target_room_id, upper(invite_code), auth.uid(), invite_granted_to, invite_role, invite_max_uses, invite_expires_at)
  returning * into created_invite;
  return created_invite;
end;
$$;

create or replace function public.revoke_room_invite(target_invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target_room_id uuid;
begin
  select room_id into target_room_id from public.room_invites where id = target_invite_id for update;
  if target_room_id is null then raise exception 'invite not found' using errcode = 'P0002'; end if;
  if not public.has_room_role(target_room_id, array['owner','moderator']::public.room_role[]) then
    raise exception 'owner or moderator role required' using errcode = '42501';
  end if;
  update public.room_invites set revoked_at = coalesce(revoked_at, now()) where id = target_invite_id;
end;
$$;

create or replace function public.redeem_room_invite(invite_code text, nickname text default null)
returns public.room_memberships language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  selected_invite public.room_invites;
  selected_room public.rooms;
  created_membership public.room_memberships;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into selected_invite from public.room_invites where code = upper(invite_code) for update;
  if selected_invite.id is null or selected_invite.revoked_at is not null
     or selected_invite.use_count >= selected_invite.max_uses
     or (selected_invite.expires_at is not null and selected_invite.expires_at <= now())
     or (selected_invite.granted_to is not null and selected_invite.granted_to <> actor) then
    raise exception 'invite is invalid' using errcode = '42501';
  end if;
  select * into selected_room from public.rooms where id = selected_invite.room_id for update;
  if selected_room.admission_policy <> 'invite_only' then
    raise exception 'this room requires an approved join request' using errcode = '42501';
  end if;
  if public.has_active_sanction(selected_room.id, actor, 'ban') then raise exception 'user is banned' using errcode = '42501'; end if;
  if selected_room.guest_policy = 'accounts_only' and public.current_user_is_anonymous() then
    raise exception 'anonymous users cannot join this room' using errcode = '42501';
  end if;
  if public.current_user_is_anonymous() and selected_invite.granted_role <> 'guest' then
    raise exception 'anonymous users may only join as guests' using errcode = '42501';
  end if;
  perform public.assert_room_capacity(selected_room.id);
  insert into public.room_memberships(room_id, user_id, role, room_nickname)
  values (selected_room.id, actor,
          case when public.current_user_is_anonymous() then 'guest'::public.room_role else selected_invite.granted_role end,
          nickname)
  returning * into created_membership;
  update public.room_invites set use_count = use_count + 1 where id = selected_invite.id;
  insert into public.activity_events(room_id, actor_id, event_type, subject_type, subject_id)
  values (selected_room.id, actor, 'member_joined', 'profile', actor);
  return created_membership;
exception when unique_violation then
  raise exception 'user is already a room member' using errcode = '23505';
end;
$$;

create or replace function public.request_room_join_with_invite(invite_code text, nickname text default null)
returns public.room_join_requests language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  selected_invite public.room_invites;
  selected_room public.rooms;
  created_request public.room_join_requests;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into selected_invite from public.room_invites where code = upper(invite_code) for update;
  if selected_invite.id is null or selected_invite.revoked_at is not null
     or selected_invite.use_count >= selected_invite.max_uses
     or (selected_invite.expires_at is not null and selected_invite.expires_at <= now())
     or (selected_invite.granted_to is not null and selected_invite.granted_to <> actor) then
    raise exception 'invite is invalid' using errcode = '42501';
  end if;
  select * into selected_room from public.rooms where id = selected_invite.room_id for update;
  if selected_room.admission_policy <> 'approval_required' then
    raise exception 'this room uses instant invite admission' using errcode = '42501';
  end if;
  if public.is_room_member(selected_room.id) or public.has_active_sanction(selected_room.id, actor, 'ban') then
    raise exception 'join request not allowed' using errcode = '42501';
  end if;
  if selected_room.guest_policy = 'accounts_only' and public.current_user_is_anonymous() then
    raise exception 'anonymous users cannot join this room' using errcode = '42501';
  end if;
  if public.current_user_is_anonymous() and selected_invite.granted_role <> 'guest' then
    raise exception 'anonymous users may only request guest access' using errcode = '42501';
  end if;
  insert into public.room_join_requests(room_id, user_id, requested_role, invite_id, room_nickname)
  values (
    selected_room.id, actor,
    case when public.current_user_is_anonymous() then 'guest'::public.room_role else selected_invite.granted_role end,
    selected_invite.id, nickname
  ) returning * into created_request;
  return created_request;
end;
$$;

create or replace function public.review_room_join_request(target_request_id uuid, approve boolean)
returns public.room_join_requests language plpgsql security definer set search_path = '' as $$
declare selected_request public.room_join_requests; selected_profile public.profiles; selected_invite public.room_invites;
begin
  select * into selected_request from public.room_join_requests where id = target_request_id for update;
  if selected_request.id is null or selected_request.status <> 'pending' then
    raise exception 'pending request not found' using errcode = 'P0002';
  end if;
  if not public.has_room_role(selected_request.room_id, array['owner','moderator']::public.room_role[]) then
    raise exception 'owner or moderator role required' using errcode = '42501';
  end if;
  if approve then
    perform public.assert_room_capacity(selected_request.room_id);
    if public.has_active_sanction(selected_request.room_id, selected_request.user_id, 'ban') then
      raise exception 'user is banned' using errcode = '42501';
    end if;
    if selected_request.invite_id is not null then
      select * into selected_invite from public.room_invites where id = selected_request.invite_id for update;
      if selected_invite.id is null or selected_invite.room_id <> selected_request.room_id
         or selected_invite.revoked_at is not null or selected_invite.use_count >= selected_invite.max_uses
         or (selected_invite.expires_at is not null and selected_invite.expires_at <= now())
         or (selected_invite.granted_to is not null and selected_invite.granted_to <> selected_request.user_id) then
        raise exception 'invite is no longer valid' using errcode = '42501';
      end if;
    end if;
    select * into selected_profile from public.profiles where id = selected_request.user_id;
    insert into public.room_memberships(room_id, user_id, role, room_nickname)
    values (selected_request.room_id, selected_request.user_id,
      case when selected_profile.identity_kind = 'anonymous' then 'guest'::public.room_role else selected_request.requested_role end,
      selected_request.room_nickname);
    if selected_request.invite_id is not null then
      update public.room_invites set use_count = use_count + 1 where id = selected_request.invite_id;
    end if;
  end if;
  update public.room_join_requests
  set status = case when approve then 'approved'::public.request_status else 'denied'::public.request_status end,
      reviewed_by = auth.uid(), reviewed_at = now()
  where id = target_request_id returning * into selected_request;
  return selected_request;
end;
$$;

create or replace function public.transfer_room_ownership(target_room_id uuid, new_owner_id uuid, reason text default 'transferred')
returns void language plpgsql security definer set search_path = '' as $$
declare old_owner_id uuid; new_owner_identity public.identity_kind;
begin
  select owner_id into old_owner_id from public.rooms where id = target_room_id for update;
  if old_owner_id is null then raise exception 'room not found' using errcode = 'P0002'; end if;
  if auth.uid() is distinct from old_owner_id then raise exception 'owner role required' using errcode = '42501'; end if;
  if new_owner_id = old_owner_id or not public.is_room_member(target_room_id, new_owner_id) then
    raise exception 'new owner must be another room member' using errcode = '22023';
  end if;
  select identity_kind into new_owner_identity from public.profiles where id = new_owner_id;
  if new_owner_identity <> 'permanent' then
    raise exception 'room owners must be permanent users' using errcode = '42501';
  end if;
  update public.room_memberships set role = 'member' where room_id = target_room_id and user_id = old_owner_id;
  update public.room_memberships set role = 'owner' where room_id = target_room_id and user_id = new_owner_id;
  update public.rooms set owner_id = new_owner_id where id = target_room_id;
  insert into public.room_ownership_history(room_id, previous_owner_id, new_owner_id, reason)
  values (target_room_id, old_owner_id, new_owner_id, reason);
end;
$$;

create or replace function public.set_room_member_role(target_room_id uuid, target_user_id uuid, new_role public.room_role)
returns public.room_memberships language plpgsql security definer set search_path = '' as $$
declare target public.room_memberships; target_identity public.identity_kind;
begin
  if not public.has_room_role(target_room_id, array['owner']::public.room_role[]) then
    raise exception 'owner role required' using errcode = '42501';
  end if;
  if new_role = 'owner' then raise exception 'use transfer_room_ownership to change owners' using errcode = '22023'; end if;
  select * into target from public.room_memberships
  where room_id = target_room_id and user_id = target_user_id for update;
  select identity_kind into target_identity from public.profiles where id = target_user_id;
  if target.user_id is null or target.role = 'owner' then raise exception 'eligible membership not found' using errcode = 'P0002'; end if;
  if target_identity = 'anonymous' and new_role <> 'guest' then
    raise exception 'anonymous users must remain guests' using errcode = '42501';
  end if;
  update public.room_memberships set role = new_role
  where room_id = target_room_id and user_id = target_user_id returning * into target;
  return target;
end;
$$;

create or replace function public.leave_room(target_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare old_role public.room_role; successor uuid;
begin
  select role into old_role from public.room_memberships where room_id = target_room_id and user_id = auth.uid() for update;
  if old_role is null then raise exception 'membership not found' using errcode = 'P0002'; end if;
  if old_role = 'owner' then
    select m.user_id into successor
    from public.room_memberships m
    join public.profiles p on p.id = m.user_id
    where m.room_id = target_room_id and m.user_id <> auth.uid() and p.identity_kind = 'permanent'
    order by case m.role when 'moderator' then 1 when 'member' then 2 else 3 end, m.succession_rank
    limit 1 for update;
    if successor is null then
      delete from public.rooms where id = target_room_id;
      return;
    end if;
    update public.room_memberships set role = 'member' where room_id = target_room_id and user_id = auth.uid();
    update public.room_memberships set role = 'owner' where room_id = target_room_id and user_id = successor;
    update public.rooms set owner_id = successor where id = target_room_id;
    insert into public.room_ownership_history(room_id, previous_owner_id, new_owner_id, reason)
    values (target_room_id, auth.uid(), successor, 'owner_left');
  end if;
  delete from public.room_memberships where room_id = target_room_id and user_id = auth.uid();
end;
$$;

create or replace function public.remove_room_member(target_room_id uuid, target_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_role public.room_role; target_role public.room_role;
begin
  select role into actor_role from public.room_memberships where room_id = target_room_id and user_id = auth.uid();
  select role into target_role from public.room_memberships where room_id = target_room_id and user_id = target_user_id for update;
  if actor_role is null or actor_role not in ('owner','moderator') or target_role is null or target_role = 'owner'
     or (actor_role = 'moderator' and target_role = 'moderator') then
    raise exception 'insufficient role to remove member' using errcode = '42501';
  end if;
  delete from public.room_memberships where room_id = target_room_id and user_id = target_user_id;
  insert into public.activity_events(room_id, actor_id, event_type, subject_type, subject_id)
  values (target_room_id, auth.uid(), 'member_removed', 'profile', target_user_id);
end;
$$;

create or replace function public.sanction_room_member(target_room_id uuid, target_user_id uuid, sanction public.sanction_kind, sanction_reason text default null, sanction_expires_at timestamptz default null)
returns public.room_sanctions language plpgsql security definer set search_path = '' as $$
declare actor_role public.room_role; target_role public.room_role; created_sanction public.room_sanctions;
begin
  select role into actor_role from public.room_memberships where room_id = target_room_id and user_id = auth.uid();
  select role into target_role from public.room_memberships where room_id = target_room_id and user_id = target_user_id;
  if actor_role is null or actor_role not in ('owner','moderator') or target_role is null or target_role = 'owner'
     or (actor_role = 'moderator' and target_role = 'moderator') then
    raise exception 'insufficient role to sanction member' using errcode = '42501';
  end if;
  insert into public.room_sanctions(room_id, user_id, kind, reason, created_by, expires_at)
  values (target_room_id, target_user_id, sanction, sanction_reason, auth.uid(), sanction_expires_at)
  returning * into created_sanction;
  if sanction = 'ban' then delete from public.room_memberships where room_id = target_room_id and user_id = target_user_id; end if;
  return created_sanction;
end;
$$;

create or replace function public.revoke_room_sanction(target_sanction_id uuid)
returns public.room_sanctions language plpgsql security definer set search_path = '' as $$
declare target public.room_sanctions;
begin
  select * into target from public.room_sanctions where id = target_sanction_id for update;
  if target.id is null then raise exception 'sanction not found' using errcode = 'P0002'; end if;
  if not public.has_room_role(target.room_id, array['owner','moderator']::public.room_role[]) then
    raise exception 'owner or moderator role required' using errcode = '42501';
  end if;
  if target.revoked_at is null then
    update public.room_sanctions set revoked_at = now(), revoked_by = auth.uid()
    where id = target.id returning * into target;
  end if;
  return target;
end;
$$;

create or replace function public.can_control_countdown(target_countdown_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.countdowns c
    where c.id = target_countdown_id and public.is_room_member(c.room_id, target_user_id) and (
      (c.scope = 'personal' and c.owner_user_id = target_user_id)
      or (c.scope = 'shared' and (
        c.creator_id = target_user_id
        or (c.control_policy = 'all_assigned' and exists (
          select 1 from public.countdown_participants p where p.countdown_id = c.id and p.user_id = target_user_id
        ))
        or (exists (
          select 1 from public.rooms r where r.id = c.room_id and r.moderators_can_control_timers
        ) and public.has_room_role(c.room_id, array['owner','moderator']::public.room_role[], target_user_id))
      ))
    )
  )
$$;

create or replace function public.create_countdown(target_scope public.timer_scope, countdown_name text, seconds integer, target_room_id uuid, policy public.timer_control_policy default 'creator_only', participant_ids uuid[] default '{}', scheduled_for timestamptz default null)
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
  insert into public.countdowns(scope, room_id, owner_user_id, creator_id, name, duration_seconds, control_policy, state, scheduled_start_at, ends_at)
  values (target_scope, target_room_id, case when target_scope = 'personal' then auth.uid() end, auth.uid(), countdown_name, seconds, policy,
    case when scheduled_for is null then 'idle'::public.timer_state else 'scheduled'::public.timer_state end,
    scheduled_for, case when scheduled_for is not null then scheduled_for + make_interval(secs => seconds) end)
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

create or replace function public.control_countdown(target_countdown_id uuid, action text)
returns public.countdowns language plpgsql security definer set search_path = '' as $$
declare timer public.countdowns; remaining integer;
begin
  select * into timer from public.countdowns where id = target_countdown_id for update;
  if timer.id is null then raise exception 'countdown not found' using errcode = 'P0002'; end if;
  if not public.can_control_countdown(timer.id) then raise exception 'countdown control denied' using errcode = '42501'; end if;
  if timer.state = 'scheduled' then
    if now() >= timer.ends_at then
      update public.countdowns set state = 'completed', scheduled_start_at = null, started_at = null, ends_at = null where id = timer.id returning * into timer;
      return timer;
    elsif action = 'start' then
      if timer.scheduled_start_at > now() then
        raise exception 'scheduled countdown cannot start early' using errcode = '22023';
      end if;
      update public.countdowns
      set state = 'running', started_at = timer.scheduled_start_at, scheduled_start_at = null
      where id = timer.id returning * into timer;
      return timer;
    elsif action = 'pause' then
      if timer.scheduled_start_at > now() then
        raise exception 'scheduled countdown has not started' using errcode = '22023';
      end if;
      remaining := greatest(0, ceil(extract(epoch from timer.ends_at - now()))::integer);
      update public.countdowns
      set state = 'paused', scheduled_start_at = null, started_at = null, ends_at = null, paused_remaining_seconds = remaining
      where id = timer.id returning * into timer;
      return timer;
    elsif action = 'complete' then
      update public.countdowns set state = 'completed', scheduled_start_at = null, ends_at = null where id = timer.id returning * into timer;
      return timer;
    elsif action = 'cancel' then
      update public.countdowns set state = 'cancelled', scheduled_start_at = null, ends_at = null where id = timer.id returning * into timer;
      return timer;
    elsif action = 'reset' then
      update public.countdowns set state = 'idle', scheduled_start_at = null, ends_at = null where id = timer.id returning * into timer;
      return timer;
    else
      raise exception 'invalid action for current timer state' using errcode = '22023';
    end if;
  end if;
  if action = 'start' and timer.state in ('idle','paused') then
    remaining := coalesce(timer.paused_remaining_seconds, timer.duration_seconds);
    update public.countdowns set state = 'running', scheduled_start_at = null, started_at = now(), ends_at = now() + make_interval(secs => remaining), paused_remaining_seconds = null where id = timer.id;
  elsif action = 'pause' and timer.state = 'running' then
    remaining := greatest(0, ceil(extract(epoch from timer.ends_at - now()))::integer);
    update public.countdowns set state = 'paused', scheduled_start_at = null, started_at = null, ends_at = null, paused_remaining_seconds = remaining where id = timer.id;
  elsif action = 'complete' and timer.state in ('running','paused') then
    update public.countdowns set state = 'completed', scheduled_start_at = null, started_at = null, ends_at = null, paused_remaining_seconds = null where id = timer.id;
  elsif action = 'cancel' and timer.state not in ('completed','cancelled') then
    update public.countdowns set state = 'cancelled', scheduled_start_at = null, started_at = null, ends_at = null, paused_remaining_seconds = null where id = timer.id;
  elsif action = 'reset' then
    update public.countdowns set state = 'idle', scheduled_start_at = null, started_at = null, ends_at = null, paused_remaining_seconds = null where id = timer.id;
  else
    raise exception 'invalid action for current timer state' using errcode = '22023';
  end if;
  select * into timer from public.countdowns where id = timer.id;
  return timer;
end;
$$;

create or replace function public.send_room_message(target_room_id uuid, message_content text, reply_to uuid default null)
returns public.messages language plpgsql security definer set search_path = '' as $$
declare created_message public.messages; reply_room uuid;
begin
  if not public.is_room_member(target_room_id) or public.has_active_sanction(target_room_id, auth.uid(), 'mute')
     or public.has_active_sanction(target_room_id, auth.uid(), 'ban') then
    raise exception 'messaging not allowed' using errcode = '42501';
  end if;
  if reply_to is not null then
    select room_id into reply_room from public.messages where id = reply_to;
    if reply_room is distinct from target_room_id then raise exception 'reply must be in the same room' using errcode = '22023'; end if;
  end if;
  insert into public.messages(room_id, author_id, reply_to_id, content)
  values (target_room_id, auth.uid(), reply_to, message_content) returning * into created_message;
  return created_message;
end;
$$;

create or replace function public.edit_room_message(target_message_id uuid, new_content text)
returns public.messages language plpgsql security definer set search_path = '' as $$
declare target public.messages;
begin
  select * into target from public.messages where id = target_message_id for update;
  if target.id is null or target.deleted_at is not null then raise exception 'message not found' using errcode = 'P0002'; end if;
  if target.author_id is distinct from auth.uid() then raise exception 'only the author may edit a message' using errcode = '42501'; end if;
  insert into public.message_revisions(message_id, editor_id, previous_content) values (target.id, auth.uid(), target.content);
  update public.messages set content = new_content, edited_at = now() where id = target.id returning * into target;
  return target;
end;
$$;

create or replace function public.delete_room_message(target_message_id uuid)
returns public.messages language plpgsql security definer set search_path = '' as $$
declare target public.messages;
begin
  select * into target from public.messages where id = target_message_id for update;
  if target.id is null then raise exception 'message not found' using errcode = 'P0002'; end if;
  if target.deleted_at is not null then return target; end if;
  if target.author_id is distinct from auth.uid() and not public.has_room_role(target.room_id, array['owner','moderator']::public.room_role[]) then
    raise exception 'message deletion denied' using errcode = '42501';
  end if;
  update public.messages set content = null, deleted_at = now(), deleted_by = auth.uid() where id = target.id returning * into target;
  return target;
end;
$$;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_memberships enable row level security;
alter table public.room_invites enable row level security;
alter table public.room_join_requests enable row level security;
alter table public.room_sanctions enable row level security;
alter table public.room_ownership_history enable row level security;
alter table public.countdowns enable row level security;
alter table public.countdown_participants enable row level security;
alter table public.activity_events enable row level security;
alter table public.messages enable row level security;
alter table public.message_revisions enable row level security;
alter table public.message_reactions enable row level security;
alter table public.notification_preferences enable row level security;

create policy profiles_shared_room_read on public.profiles for select to authenticated using (public.shares_room_with(id));
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy rooms_member_read on public.rooms for select to authenticated using (public.is_room_member(id));
create policy memberships_member_read on public.room_memberships for select to authenticated using (public.is_room_member(room_id));
create policy invites_staff_read on public.room_invites for select to authenticated using (public.has_room_role(room_id, array['owner','moderator']::public.room_role[]));
create policy join_requests_read on public.room_join_requests for select to authenticated using (user_id = auth.uid() or public.has_room_role(room_id, array['owner','moderator']::public.room_role[]));
create policy sanctions_room_read on public.room_sanctions for select to authenticated using (user_id = auth.uid() or public.has_room_role(room_id, array['owner','moderator']::public.room_role[]));
create policy ownership_history_member_read on public.room_ownership_history for select to authenticated using (public.is_room_member(room_id));
create policy countdowns_read on public.countdowns for select to authenticated using (owner_user_id = auth.uid() or (room_id is not null and public.is_room_member(room_id)));
create policy participants_read on public.countdown_participants for select to authenticated using (
  exists (select 1 from public.countdowns c where c.id = countdown_id and (c.owner_user_id = auth.uid() or public.is_room_member(c.room_id)))
);
create policy activity_read on public.activity_events for select to authenticated using (actor_id = auth.uid() or (room_id is not null and public.is_room_member(room_id)));
create policy messages_member_read on public.messages for select to authenticated using (public.is_room_member(room_id));
create policy revisions_member_read on public.message_revisions for select to authenticated using (
  exists (select 1 from public.messages m where m.id = message_id and public.is_room_member(m.room_id))
);
create policy reactions_member_read on public.message_reactions for select to authenticated using (
  exists (select 1 from public.messages m where m.id = message_id and public.is_room_member(m.room_id))
);
create policy reactions_member_insert on public.message_reactions for insert to authenticated with check (
  user_id = auth.uid() and exists (
    select 1 from public.messages m where m.id = message_id and m.deleted_at is null
      and public.is_room_member(m.room_id)
      and not public.has_active_sanction(m.room_id, auth.uid(), 'mute')
      and not public.has_active_sanction(m.room_id, auth.uid(), 'ban')
  )
);
create policy reactions_self_delete on public.message_reactions for delete to authenticated using (user_id = auth.uid());
create policy notification_preferences_self_read on public.notification_preferences for select to authenticated using (user_id = auth.uid());
create policy notification_preferences_self_update on public.notification_preferences for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles, public.rooms, public.room_memberships, public.room_invites, public.room_join_requests,
  public.room_sanctions, public.room_ownership_history, public.countdowns, public.countdown_participants,
  public.activity_events, public.messages, public.message_revisions, public.message_reactions,
  public.notification_preferences to authenticated;
grant update(handle, display_name) on public.profiles to authenticated;
grant insert, delete on public.message_reactions to authenticated;
grant update(room_activity, timer_updates, chat_mentions, join_requests) on public.notification_preferences to authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.current_user_is_anonymous(), public.is_room_member(uuid, uuid),
  public.has_room_role(uuid, public.room_role[], uuid), public.shares_room_with(uuid),
  public.has_active_sanction(uuid, uuid, public.sanction_kind), public.can_control_countdown(uuid, uuid)
  to authenticated;
grant execute on function public.create_room(text, public.admission_policy, public.guest_policy, integer, boolean),
  public.create_room_invite(uuid, text, public.room_role, uuid, integer, timestamptz),
  public.revoke_room_invite(uuid), public.redeem_room_invite(text, text),
  public.request_room_join_with_invite(text, text),
  public.review_room_join_request(uuid, boolean),
  public.transfer_room_ownership(uuid, uuid, text), public.set_room_member_role(uuid, uuid, public.room_role),
  public.leave_room(uuid), public.remove_room_member(uuid, uuid),
  public.sanction_room_member(uuid, uuid, public.sanction_kind, text, timestamptz),
  public.revoke_room_sanction(uuid),
  public.create_countdown(public.timer_scope, text, integer, uuid, public.timer_control_policy, uuid[], timestamptz),
  public.control_countdown(uuid, text), public.send_room_message(uuid, text, uuid),
  public.edit_room_message(uuid, text), public.delete_room_message(uuid)
  to authenticated;

alter publication supabase_realtime add table public.room_memberships, public.countdowns, public.messages, public.message_reactions, public.activity_events;

create or replace function public.realtime_room_id(target_topic text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  if target_topic ~ '^room:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    return substr(target_topic, 6)::uuid;
  end if;
  return null;
end;
$$;
grant execute on function public.realtime_room_id(text) to authenticated;

create policy room_broadcast_read on realtime.messages for select to authenticated using (
  public.is_room_member(public.realtime_room_id(realtime.topic()))
);
create policy room_broadcast_write on realtime.messages for insert to authenticated with check (
  public.is_room_member(public.realtime_room_id(realtime.topic()))
  and not public.has_active_sanction(public.realtime_room_id(realtime.topic()), auth.uid(), 'ban')
);
