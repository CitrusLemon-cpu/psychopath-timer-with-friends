alter table public.rooms
add column is_personal boolean not null default false;

create unique index rooms_one_personal_per_owner
on public.rooms(owner_id)
where is_personal;

create function public.ensure_personal_room()
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  personal_room public.rooms;
begin
  if actor is null or public.current_user_is_anonymous() then
    raise exception 'permanent account required' using errcode = '42501';
  end if;

  select * into personal_room
  from public.rooms
  where owner_id = actor and is_personal
  for update;

  if personal_room.id is null then
    insert into public.rooms(owner_id, name, admission_policy, guest_policy, capacity, moderators_can_control_timers, is_personal)
    values (actor, 'Personal Room', 'invite_only', 'accounts_only', 2, false, true)
    on conflict (owner_id) where is_personal do nothing
    returning * into personal_room;

    if personal_room.id is not null then
      insert into public.room_memberships(room_id, user_id, role) values (personal_room.id, actor, 'owner');
      insert into public.room_ownership_history(room_id, new_owner_id, reason) values (personal_room.id, actor, 'created');
      insert into public.activity_events(room_id, actor_id, event_type, subject_type, subject_id)
      values (personal_room.id, actor, 'room_created', 'room', personal_room.id);
    else
      select * into personal_room from public.rooms where owner_id = actor and is_personal;
    end if;
  end if;

  return personal_room;
end;
$$;

create function public.enforce_personal_room_boundaries()
returns trigger language plpgsql set search_path = '' as $$
declare target_room public.rooms;
begin
  select * into target_room from public.rooms where id = new.room_id;
  if target_room.is_personal and (new.user_id <> target_room.owner_id or new.role <> 'owner') then
    raise exception 'personal rooms cannot accept members' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger memberships_enforce_personal_room
before insert or update on public.room_memberships
for each row execute function public.enforce_personal_room_boundaries();

create function public.reject_personal_room_invites()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.rooms where id = new.room_id and is_personal) then
    raise exception 'personal rooms cannot create invites' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger invites_reject_personal_room
before insert or update on public.room_invites
for each row execute function public.reject_personal_room_invites();

create function public.reject_shared_personal_room_countdowns()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.scope = 'shared' and exists (select 1 from public.rooms where id = new.room_id and is_personal) then
    raise exception 'personal rooms only support personal timers' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger countdowns_reject_shared_in_personal_room
before insert or update of scope, room_id on public.countdowns
for each row execute function public.reject_shared_personal_room_countdowns();

create or replace function public.leave_room(target_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare old_role public.room_role; successor uuid;
begin
  if exists (select 1 from public.rooms where id = target_room_id and is_personal) then
    raise exception 'personal rooms cannot be left' using errcode = '42501';
  end if;
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

revoke all on function public.ensure_personal_room() from public, anon, authenticated;
grant execute on function public.ensure_personal_room() to authenticated;
