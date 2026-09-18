create or replace function public.server_time()
returns timestamptz language sql stable set search_path = '' as $$
  select statement_timestamp()
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
  actor_profile public.profiles;
  created_room public.rooms;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if public.current_user_is_anonymous() then
    raise exception 'anonymous users cannot create rooms' using errcode = '42501';
  end if;
  select * into actor_profile from public.profiles where id = actor;
  if actor_profile.display_name is null
     or actor_profile.handle = 'user_' || substr(md5(actor::text), 1, 19) then
    raise exception 'complete profile required to create rooms' using errcode = '42501';
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

revoke all on function public.server_time() from public, anon, authenticated;
grant execute on function public.server_time() to authenticated;
