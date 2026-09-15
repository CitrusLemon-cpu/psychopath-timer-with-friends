create extension if not exists pgcrypto with schema extensions;

create type public.identity_kind as enum ('anonymous', 'permanent');
create type public.room_role as enum ('owner', 'moderator', 'member', 'guest');
create type public.admission_policy as enum ('invite_only', 'approval_required');
create type public.guest_policy as enum ('allow_guests', 'accounts_only');
create type public.request_status as enum ('pending', 'approved', 'denied', 'cancelled');
create type public.sanction_kind as enum ('mute', 'ban');
create type public.timer_scope as enum ('personal', 'shared');
create type public.timer_control_policy as enum ('creator_only', 'all_assigned');
create type public.timer_state as enum ('idle', 'scheduled', 'running', 'paused', 'completed', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text not null,
  display_name text,
  identity_kind public.identity_kind not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_handle_format check (handle ~ '^[a-z0-9_]{3,24}$'),
  constraint profiles_display_name_length check (display_name is null or char_length(display_name) between 1 and 50)
);
create unique index profiles_handle_unique on public.profiles (lower(handle));

create table public.rooms (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  name text not null,
  admission_policy public.admission_policy not null default 'invite_only',
  guest_policy public.guest_policy not null default 'allow_guests',
  capacity smallint not null default 10,
  moderators_can_control_timers boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rooms_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint rooms_capacity check (capacity between 2 and 50)
);

create table public.room_memberships (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.room_role not null,
  room_nickname text,
  succession_rank bigint generated always as identity,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id),
  unique (room_id, succession_rank),
  constraint memberships_nickname_length check (room_nickname is null or char_length(btrim(room_nickname)) between 1 and 40)
);
create unique index room_single_owner on public.room_memberships(room_id) where role = 'owner';
create index memberships_user_room on public.room_memberships(user_id, room_id);

create table public.room_invites (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  code text not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  granted_to uuid references public.profiles(id) on delete cascade,
  granted_role public.room_role not null default 'member',
  max_uses smallint not null default 1,
  use_count smallint not null default 0,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint invites_code_format check (code ~ '^[A-Z0-9]{6,12}$'),
  constraint invites_role check (granted_role in ('member', 'guest')),
  constraint invites_use_limits check (max_uses between 1 and 50 and use_count between 0 and max_uses),
  constraint invites_expiration check (expires_at is null or expires_at > created_at)
);
create unique index room_invites_code_unique on public.room_invites(code);
create index room_invites_room_active on public.room_invites(room_id, expires_at) where revoked_at is null;

create table public.room_join_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  requested_role public.room_role not null default 'member',
  invite_id uuid references public.room_invites(id) on delete set null,
  room_nickname text,
  status public.request_status not null default 'pending',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint join_requests_role check (requested_role in ('member', 'guest')),
  constraint join_requests_nickname_length check (room_nickname is null or char_length(btrim(room_nickname)) between 1 and 40),
  constraint join_requests_review_state check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status = 'cancelled' and reviewed_by is null and reviewed_at is not null)
    or (status in ('approved', 'denied') and reviewed_by is not null and reviewed_at is not null)
  )
);
create unique index join_requests_one_pending on public.room_join_requests(room_id, user_id) where status = 'pending';
create index join_requests_room_status on public.room_join_requests(room_id, status, created_at);

create table public.room_sanctions (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind public.sanction_kind not null,
  reason text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint sanctions_reason_length check (reason is null or char_length(reason) <= 500),
  constraint sanctions_expiration check (expires_at is null or expires_at > created_at),
  constraint sanctions_revocation check ((revoked_at is null) = (revoked_by is null))
);
create index sanctions_room_user_active on public.room_sanctions(room_id, user_id, kind) where revoked_at is null;

create table public.room_ownership_history (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  previous_owner_id uuid references public.profiles(id) on delete set null,
  new_owner_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (reason in ('created', 'transferred', 'owner_left')),
  created_at timestamptz not null default now()
);
create index ownership_history_room_created on public.room_ownership_history(room_id, created_at desc);

create table public.countdowns (
  id uuid primary key default extensions.gen_random_uuid(),
  scope public.timer_scope not null,
  room_id uuid not null references public.rooms(id) on delete cascade,
  owner_user_id uuid references public.profiles(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete restrict,
  name text not null,
  duration_seconds integer not null,
  control_policy public.timer_control_policy not null default 'creator_only',
  state public.timer_state not null default 'idle',
  scheduled_start_at timestamptz,
  started_at timestamptz,
  ends_at timestamptz,
  paused_remaining_seconds integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint countdowns_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint countdowns_duration check (duration_seconds between 1 and 31536000),
  constraint countdowns_scope_parent check (
    (scope = 'personal' and owner_user_id is not null and owner_user_id = creator_id)
    or (scope = 'shared' and owner_user_id is null)
  ),
  constraint countdowns_timing_shape check (
    (state = 'scheduled' and scheduled_start_at is not null and started_at is null and ends_at = scheduled_start_at + make_interval(secs => duration_seconds) and paused_remaining_seconds is null)
    or (state = 'running' and scheduled_start_at is null and started_at is not null and ends_at is not null and ends_at > started_at and paused_remaining_seconds is null)
    or (state = 'paused' and scheduled_start_at is null and started_at is null and ends_at is null and paused_remaining_seconds between 0 and duration_seconds)
    or (state in ('idle', 'completed', 'cancelled') and scheduled_start_at is null and started_at is null and ends_at is null and paused_remaining_seconds is null)
  )
);
create index countdowns_room_updated on public.countdowns(room_id, updated_at desc);
create index countdowns_scheduled_start on public.countdowns(scheduled_start_at) where state = 'scheduled';

create table public.countdown_participants (
  countdown_id uuid not null references public.countdowns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (countdown_id, user_id)
);
create index countdown_participants_user on public.countdown_participants(user_id, countdown_id);

create or replace function public.enforce_countdown_participant_shape()
returns trigger language plpgsql set search_path = '' as $$
declare target_id uuid; target_scope public.timer_scope;
begin
  if tg_table_name = 'countdowns' then
    if tg_op = 'DELETE' then target_id := old.id; else target_id := new.id; end if;
  else
    if tg_op = 'DELETE' then target_id := old.countdown_id; else target_id := new.countdown_id; end if;
  end if;
  select scope into target_scope from public.countdowns where id = target_id;
  if target_scope is null then return null; end if;
  if target_scope = 'shared' and not exists (
    select 1 from public.countdown_participants where countdown_id = target_id
  ) then
    raise exception 'shared timers require at least one participant' using errcode = '23514';
  end if;
  if target_scope = 'personal' and exists (
    select 1 from public.countdown_participants where countdown_id = target_id
  ) then
    raise exception 'personal timers cannot have participants' using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger countdown_participant_shape_from_countdown
after insert or update of scope on public.countdowns deferrable initially deferred
for each row execute function public.enforce_countdown_participant_shape();
create constraint trigger countdown_participant_shape_from_participant
after insert or update or delete on public.countdown_participants deferrable initially deferred
for each row execute function public.enforce_countdown_participant_shape();

create table public.activity_events (
  id bigint generated always as identity primary key,
  room_id uuid references public.rooms(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  subject_type text,
  subject_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint activity_event_type_format check (event_type ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint activity_subject_type_format check (subject_type is null or subject_type ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint activity_details_object check (jsonb_typeof(details) = 'object')
);
create index activity_room_recent on public.activity_events(room_id, created_at desc) where room_id is not null;
create index activity_actor_recent on public.activity_events(actor_id, created_at desc);

create table public.messages (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  reply_to_id uuid references public.messages(id) on delete set null,
  content text,
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint messages_content_state check (
    (deleted_at is null and deleted_by is null and content is not null and char_length(btrim(content)) between 1 and 4000)
    or (deleted_at is not null and deleted_by is not null and content is null)
  )
);
create index messages_room_recent on public.messages(room_id, created_at desc);
create index messages_reply on public.messages(reply_to_id) where reply_to_id is not null;

create table public.message_revisions (
  id bigint generated always as identity primary key,
  message_id uuid not null references public.messages(id) on delete cascade,
  editor_id uuid not null references public.profiles(id) on delete restrict,
  previous_content text not null,
  revised_at timestamptz not null default now()
);
create index message_revisions_message on public.message_revisions(message_id, revised_at);

create table public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji),
  constraint reactions_emoji_length check (char_length(emoji) between 1 and 16 and emoji !~ '[[:space:]]')
);

create table public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  room_activity boolean not null default true,
  timer_updates boolean not null default true,
  chat_mentions boolean not null default true,
  join_requests boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger rooms_updated_at before update on public.rooms for each row execute function public.set_updated_at();
create trigger memberships_updated_at before update on public.room_memberships for each row execute function public.set_updated_at();
create trigger join_requests_updated_at before update on public.room_join_requests for each row execute function public.set_updated_at();
create trigger countdowns_updated_at before update on public.countdowns for each row execute function public.set_updated_at();
create trigger messages_updated_at before update on public.messages for each row execute function public.set_updated_at();
create trigger notification_preferences_updated_at before update on public.notification_preferences for each row execute function public.set_updated_at();

create or replace function public.sync_auth_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, handle, display_name, identity_kind)
  values (
    new.id,
    'user_' || substr(md5(new.id::text), 1, 19),
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    case when new.is_anonymous then 'anonymous'::public.identity_kind else 'permanent'::public.identity_kind end
  )
  on conflict (id) do update set
    identity_kind = excluded.identity_kind,
    display_name = coalesce(public.profiles.display_name, excluded.display_name);

  insert into public.notification_preferences(user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger auth_user_profile after insert or update of is_anonymous on auth.users
for each row execute function public.sync_auth_profile();

insert into public.profiles (id, handle, display_name, identity_kind)
select id, 'user_' || substr(md5(id::text), 1, 19),
       nullif(btrim(raw_user_meta_data ->> 'display_name'), ''),
       case when is_anonymous then 'anonymous'::public.identity_kind else 'permanent'::public.identity_kind end
from auth.users on conflict (id) do nothing;

insert into public.notification_preferences(user_id)
select id from public.profiles on conflict do nothing;
