begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_anonymous
)
values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-edits@example.test', '', now(), '{}', '{}', now(), now(), false),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member-edits@example.test', '', now(), '{}', '{}', now(), now(), false),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider-edits@example.test', '', now(), '{}', '{}', now(), now(), false);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}', true);
select lives_ok($$update public.profiles set handle = 'edit_owner', display_name = 'Owner' where id = auth.uid()$$, 'a generated handle can be set once');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}', true);
select throws_like($$update public.profiles set handle = 'edit_owner', display_name = 'Member' where id = auth.uid()$$, '%duplicate key%', 'handles remain globally unique');
select lives_ok($$update public.profiles set handle = 'edit_member', display_name = 'Member' where id = auth.uid()$$, 'a second user can claim a unique handle');
select throws_ok($$update public.profiles set handle = 'changed_member' where id = auth.uid()$$, '23514', 'handle cannot be changed', 'an established handle cannot be changed');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}', true);
select lives_ok($$select public.create_room('Editable timers', 'invite_only', 'accounts_only', 4, false)$$, 'creator makes a room');
select lives_ok($$select public.create_room_invite((select id from public.rooms where name = 'Editable timers'), 'EDIT01')$$, 'creator makes an invite');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}', true);
select lives_ok($$select public.redeem_room_invite('EDIT01')$$, 'assigned editor joins the room');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}', true);
select lives_ok(
  $$select public.create_countdown('shared', 'Shared original', 60, (select id from public.rooms where name = 'Editable timers'), 'creator_only', array['20000000-0000-0000-0000-000000000002']::uuid[], null, '#54d6d2')$$,
  'creator makes an assigned shared timer'
);

select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}', true);
select ok(public.can_edit_countdown((select id from public.countdowns where name = 'Shared original')), 'assigned crew can edit a shared timer');
select lives_ok(
  $$select public.update_countdown((select id from public.countdowns where name = 'Shared original'), 'shared', 'Shared revised', 90, '#ef4b4b', 'creator_only', array['20000000-0000-0000-0000-000000000002']::uuid[], null, true)$$,
  'assigned crew can update the shared timer'
);
select is((select name from public.countdowns where name = 'Shared revised'), 'Shared revised', 'the shared timer update is stored');

select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}', true);
select lives_ok(
  $$select public.create_countdown('personal', 'Personal original', 60, (select id from public.rooms where name = 'Editable timers'), 'creator_only', '{}'::uuid[], null, '#54d6d2')$$,
  'creator makes a personal timer'
);

select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}', true);
select isnt(public.can_edit_countdown((select id from public.countdowns where name = 'Personal original')), true, 'other room members cannot edit a personal timer');
select throws_ok(
  $$select public.update_countdown((select id from public.countdowns where name = 'Personal original'), 'personal', 'Denied', 60, '#54d6d2', 'creator_only', '{}'::uuid[], null, true)$$,
  '42501', 'countdown edit denied', 'another member cannot update a personal timer'
);

select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}', true);
select lives_ok(
  $$select public.update_countdown((select id from public.countdowns where name = 'Personal original'), 'personal', 'Personal revised', 120, '#f0c86b', 'creator_only', '{}'::uuid[], null, true)$$,
  'the personal timer creator can update it'
);

select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":false}', true);
select isnt(public.can_edit_countdown((select id from public.countdowns where name = 'Shared revised')), true, 'an outsider cannot edit a shared timer');

select * from finish();
rollback;
