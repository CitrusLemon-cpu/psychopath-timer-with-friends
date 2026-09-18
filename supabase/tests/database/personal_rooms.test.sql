begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_anonymous
)
values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'personal@example.test', '', now(), '{}', '{}', now(), now(), false),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, '', null, '{}', '{}', now(), now(), true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"40000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}', true);
select lives_ok($$update public.profiles set handle = 'personal_user', display_name = 'Personal User' where id = auth.uid()$$, 'account completes its profile');
select lives_ok($$select public.ensure_personal_room()$$, 'account provisions a personal room');
select lives_ok($$select public.ensure_personal_room()$$, 'personal room provisioning is idempotent');
select is((select count(*)::integer from public.rooms where owner_id = auth.uid() and is_personal), 1, 'account has exactly one personal room');
select is(
  (select role::text from public.room_memberships where room_id = (select id from public.rooms where owner_id = auth.uid() and is_personal) and user_id = auth.uid()),
  'owner', 'account owns its personal room'
);
select throws_ok(
  $$select public.create_room_invite((select id from public.rooms where owner_id = auth.uid() and is_personal), 'PRIVATE1')$$,
  '42501', 'personal rooms cannot create invites', 'personal rooms cannot issue invites'
);
select throws_ok(
  $$select public.create_countdown('shared', 'Shared denied', 60, (select id from public.rooms where owner_id = auth.uid() and is_personal), 'creator_only', array[auth.uid()]::uuid[])$$,
  '22023', 'personal rooms only support personal timers', 'personal rooms reject shared timers'
);
select lives_ok(
  $$select public.create_countdown('personal', 'Personal allowed', 60, (select id from public.rooms where owner_id = auth.uid() and is_personal))$$,
  'personal rooms accept personal timers'
);
select throws_ok(
  $$select public.leave_room((select id from public.rooms where owner_id = auth.uid() and is_personal))$$,
  '42501', 'personal rooms cannot be left', 'personal rooms cannot be left'
);

select set_config('request.jwt.claims', '{"sub":"40000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":true}', true);
select throws_ok($$select public.ensure_personal_room()$$, '42501', 'permanent account required', 'anonymous users cannot create server-backed personal rooms');

select * from finish();
rollback;
