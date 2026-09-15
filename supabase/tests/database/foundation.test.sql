begin;
create extension if not exists pgtap with schema extensions;
select plan(64);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_anonymous
)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@example.test', '', now(), '{}', '{"display_name":"Owner"}', now(), now(), false),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member@example.test', '', now(), '{}', '{}', now(), now(), false),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@example.test', '', now(), '{}', '{}', now(), now(), false),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, '', null, '{}', '{}', now(), now(), true);

select is(
  (select identity_kind::text from public.profiles where id = '10000000-0000-0000-0000-000000000001'),
  'permanent', 'permanent auth users receive permanent profiles'
);
select is(
  (select identity_kind::text from public.profiles where id = '10000000-0000-0000-0000-000000000004'),
  'anonymous', 'anonymous auth users receive anonymous profiles'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}', true);
select lives_ok(
  $$select public.create_room('Capacity room', 'invite_only', 'allow_guests', 2, false)$$,
  'an authenticated account can atomically create a room'
);
select is(
  (select role::text from public.room_memberships where user_id = auth.uid() and room_id = (select id from public.rooms where name = 'Capacity room')),
  'owner', 'room creation also creates its owner membership'
);
select lives_ok(
  $$select public.create_room_invite((select id from public.rooms where name = 'Capacity room'), 'MEMBER1', 'member')$$,
  'owner can create a revocable invite grant'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}', true);
select lives_ok($$select public.redeem_room_invite('MEMBER1')$$, 'invite redemption atomically adds a member');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}', true);
select lives_ok(
  $$select public.create_room_invite((select id from public.rooms where name = 'Capacity room'), 'MEMBER2', 'member')$$,
  'owner can issue another grant even when the room is full'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":false}', true);
select throws_ok(
  $$select public.redeem_room_invite('MEMBER2')$$, 'P0001', 'room is at capacity',
  'locked capacity enforcement rejects the fifty-first-style join'
);

select lives_ok(
  $$select public.create_room('Isolated room', 'invite_only', 'accounts_only', 10, false)$$,
  'a permanent outsider can create an account-only room'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}', true);
select is(
  (select count(*)::integer from public.rooms where name = 'Isolated room'), 0,
  'RLS hides rooms across membership boundaries'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":true}', true);
select throws_ok(
  $$select public.create_room('Forbidden room', 'invite_only', 'accounts_only', 10, false)$$,
  '42501', 'anonymous users cannot create rooms',
  'JWT anonymous status prevents guests from creating any room'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":false}', true);
select lives_ok($$select public.create_room('Guest room', 'invite_only', 'allow_guests', 5, false)$$, 'account creates guest-enabled room');
select lives_ok(
  $$select public.create_room_invite((select id from public.rooms where name = 'Guest room'), 'GUEST01', 'member')$$,
  'room owner creates a member-only grant'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":true}', true);
select throws_ok(
  $$select public.redeem_room_invite('GUEST01')$$, '42501', 'anonymous users may only join as guests',
  'anonymous users cannot gain permanent-member roles'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":false}', true);
select lives_ok(
  $$select public.create_room_invite((select id from public.rooms where name = 'Guest room'), 'GUEST02', 'guest')$$,
  'room owner can issue a guest grant'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":true}', true);
select lives_ok($$select public.redeem_room_invite('GUEST02')$$, 'anonymous user can join a guest-enabled room as guest');
select lives_ok(
  $$select public.create_countdown('personal', 'Guest personal', 30, (select id from public.rooms where name = 'Guest room'))$$,
  'guest can create a room-scoped personal timer'
);
select lives_ok(
  $$select public.control_countdown((select id from public.countdowns where name = 'Guest personal'), 'start')$$,
  'guest exclusively controls their personal timer'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":false}', true);
select is(
  (select count(*)::integer from public.countdowns where name = 'Guest personal' and room_id = (select id from public.rooms where name = 'Guest room')),
  1, 'other room members can see a room-scoped personal timer'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":true}', true);
select throws_ok(
  $$select public.create_countdown('shared', 'Guest shared', 30, (select id from public.rooms where name = 'Guest room'), 'all_assigned', array['10000000-0000-0000-0000-000000000004']::uuid[])$$,
  '42501', 'anonymous guests cannot create shared timers',
  'guest cannot create a shared timer'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}', true);
select lives_ok(
  $$select public.set_room_member_role((select id from public.rooms where name = 'Capacity room'), '10000000-0000-0000-0000-000000000002', 'moderator')$$,
  'owner can promote a permanent member to moderator'
);
select lives_ok(
  $$select public.create_countdown('shared', 'Creator controlled', 60, (select id from public.rooms where name = 'Capacity room'), 'creator_only', array['10000000-0000-0000-0000-000000000002']::uuid[])$$,
  'room member can create a shared creator-controlled timer'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}', true);
select throws_ok(
  $$select public.control_countdown((select id from public.countdowns where name = 'Creator controlled'), 'start')$$,
  '42501', 'countdown control denied',
  'assigned non-creator cannot control creator-only timer when moderator override is disabled'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}', true);
select throws_ok(
  $$select public.create_countdown('shared', 'Nobody assigned', 60, (select id from public.rooms where name = 'Capacity room'))$$,
  '22023', 'shared timers require at least one participant',
  'shared timer creation requires a participant'
);
select lives_ok(
  $$select public.create_countdown('shared', 'Assigned controlled', 60, (select id from public.rooms where name = 'Capacity room'), 'all_assigned', array['10000000-0000-0000-0000-000000000002']::uuid[])$$,
  'creator can assign all-assigned control'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}', true);
select lives_ok(
  $$select public.control_countdown((select id from public.countdowns where name = 'Assigned controlled'), 'start')$$,
  'assigned participant can control an all-assigned timer'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}', true);
select lives_ok(
  $$select public.create_countdown('shared', 'Scheduled shared', 3600, (select id from public.rooms where name = 'Capacity room'), 'creator_only', array['10000000-0000-0000-0000-000000000002']::uuid[], now() + interval '1 hour')$$,
  'creator can schedule a shared timer for a future start'
);
select is((select state::text from public.countdowns where name = 'Scheduled shared'), 'scheduled', 'future timer uses scheduled state');
select ok((select scheduled_start_at > now() from public.countdowns where name = 'Scheduled shared'), 'scheduled start is an authoritative future timestamp');
select ok(
  (select ends_at = scheduled_start_at + make_interval(secs => duration_seconds) from public.countdowns where name = 'Scheduled shared'),
  'scheduled end is fixed from scheduled start plus duration'
);
select throws_ok(
  $$select public.control_countdown((select id from public.countdowns where name = 'Scheduled shared'), 'start')$$,
  '22023', 'scheduled countdown cannot start early',
  'scheduled timer cannot be started before its authoritative start'
);
reset role;
create temporary table expected_timer_end(end_at timestamptz);
with shifted as (
  update public.countdowns
  set scheduled_start_at = scheduled_start_at - interval '70 minutes', ends_at = ends_at - interval '70 minutes'
  where name = 'Scheduled shared' returning ends_at
)
insert into expected_timer_end select ends_at from shifted;
grant select on expected_timer_end to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}', true);
select lives_ok(
  $$select public.control_countdown((select id from public.countdowns where name = 'Scheduled shared'), 'start')$$,
  'scheduled timer can enter running state after its planned start'
);
select is(
  (select ends_at from public.countdowns where name = 'Scheduled shared'),
  (select end_at from expected_timer_end),
  'late start preserves the authoritative scheduled end'
);
select ok(
  (select extract(epoch from ends_at - now()) between 2990 and 3010 from public.countdowns where name = 'Scheduled shared'),
  'timer opened ten minutes late has about fifty minutes remaining'
);
select lives_ok(
  $$select public.create_countdown('shared', 'Scheduled pause', 3600, (select id from public.rooms where name = 'Capacity room'), 'creator_only', array['10000000-0000-0000-0000-000000000002']::uuid[], now() + interval '1 hour')$$,
  'second future timer is created for direct scheduled pause coverage'
);
reset role;
update public.countdowns
set scheduled_start_at = scheduled_start_at - interval '70 minutes', ends_at = ends_at - interval '70 minutes'
where name = 'Scheduled pause';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}', true);
select lives_ok(
  $$select public.control_countdown((select id from public.countdowns where name = 'Scheduled pause'), 'pause')$$,
  'scheduled timer can be paused after its planned start without restarting'
);
select ok(
  (select state = 'paused' and paused_remaining_seconds between 2990 and 3010 and ends_at is null from public.countdowns where name = 'Scheduled pause'),
  'scheduled pause captures remaining time from the original end'
);
select lives_ok(
  $$select public.create_countdown('shared', 'Elapsed scheduled', 60, (select id from public.rooms where name = 'Capacity room'), 'creator_only', array['10000000-0000-0000-0000-000000000002']::uuid[], now() + interval '1 hour')$$,
  'elapsed-normalization timer is created'
);
reset role;
update public.countdowns
set scheduled_start_at = scheduled_start_at - interval '2 hours', ends_at = ends_at - interval '2 hours'
where name = 'Elapsed scheduled';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}', true);
select lives_ok(
  $$select public.control_countdown((select id from public.countdowns where name = 'Elapsed scheduled'), 'start')$$,
  'an elapsed scheduled row normalizes without restarting its duration'
);
select is((select state::text from public.countdowns where name = 'Elapsed scheduled'), 'completed', 'elapsed scheduled timer normalizes to completed');
select lives_ok($$set constraints all immediate$$, 'deferred participant-shape constraints accept valid timers');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":false}', true);
select lives_ok(
  $$select public.create_room('Approval room', 'approval_required', 'allow_guests', 5, false)$$,
  'account can create an approval-required room'
);
select lives_ok(
  $$select public.create_room_invite((select id from public.rooms where name = 'Approval room'), 'APPROV1', 'member', '10000000-0000-0000-0000-000000000002')$$,
  'approval room can issue a user-bound invite'
);
select hasnt_function(
  'public', 'request_room_join', array['uuid', 'public.room_role'],
  'knowing a private room UUID exposes no invite-free join-request function'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}', true);
select throws_ok(
  $$select public.redeem_room_invite('APPROV1', 'Pending Nick')$$,
  '42501', 'this room requires an approved join request',
  'instant redemption cannot bypass approval-required admission'
);
select lives_ok(
  $$select public.request_room_join_with_invite('APPROV1', 'Pending Nick')$$,
  'invite code safely creates a pending request without exposing the room'
);
select ok(
  (select invite_id is not null and room_nickname = 'Pending Nick' from public.room_join_requests where user_id = auth.uid() and status = 'pending'),
  'pending request retains invite and nickname context'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":false}', true);
select is((select use_count::integer from public.room_invites where code = 'APPROV1'), 0, 'pending request does not consume its invite early');
select lives_ok(
  $$select public.review_room_join_request((select id from public.room_join_requests where room_id = (select id from public.rooms where name = 'Approval room') and status = 'pending'), true)$$,
  'owner atomically approves the request and consumes its invite'
);
select is((select use_count::integer from public.room_invites where code = 'APPROV1'), 1, 'approved request consumes exactly one invite use');
select is(
  (select room_nickname from public.room_memberships where room_id = (select id from public.rooms where name = 'Approval room') and user_id = '10000000-0000-0000-0000-000000000002'),
  'Pending Nick', 'approval carries the requested nickname into membership'
);

select lives_ok($$select public.create_room('Guest succession', 'invite_only', 'allow_guests', 5, false)$$, 'owner creates succession test room');
select lives_ok(
  $$select public.create_room_invite((select id from public.rooms where name = 'Guest succession'), 'SUCGST', 'guest')$$,
  'owner invites anonymous succession candidate'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":true}', true);
select lives_ok($$select public.redeem_room_invite('SUCGST')$$, 'anonymous guest joins succession room');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":false}', true);
select throws_ok(
  $$select public.transfer_room_ownership((select id from public.rooms where name = 'Guest succession'), '10000000-0000-0000-0000-000000000004')$$,
  '42501', 'room owners must be permanent users',
  'explicit ownership transfer cannot promote an anonymous guest'
);
select lives_ok($$select public.leave_room((select id from public.rooms where name = 'Guest succession'))$$, 'owner leave succeeds when only an anonymous guest remains');
reset role;
select is((select count(*)::integer from public.rooms where name = 'Guest succession'), 0, 'room is deleted instead of promoting an anonymous guest');
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":false}', true);
select lives_ok($$select public.create_room('Registered succession', 'invite_only', 'allow_guests', 5, false)$$, 'owner creates registered succession room');
select lives_ok(
  $$select public.create_room_invite((select id from public.rooms where name = 'Registered succession'), 'SUC2GT', 'guest')$$,
  'anonymous guest is invited first'
);
select lives_ok(
  $$select public.create_room_invite((select id from public.rooms where name = 'Registered succession'), 'SUC2MB', 'member')$$,
  'registered member is invited second'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":true}', true);
select lives_ok($$select public.redeem_room_invite('SUC2GT')$$, 'anonymous guest joins before registered successor');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}', true);
select lives_ok($$select public.redeem_room_invite('SUC2MB')$$, 'registered successor joins later');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":false}', true);
select lives_ok($$select public.leave_room((select id from public.rooms where name = 'Registered succession'))$$, 'owner leave selects an eligible successor');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}', true);
select is(
  (select role::text from public.room_memberships where room_id = (select id from public.rooms where name = 'Registered succession') and user_id = auth.uid()),
  'owner', 'registered member succeeds ahead of an earlier anonymous guest'
);

select * from finish();
rollback;
