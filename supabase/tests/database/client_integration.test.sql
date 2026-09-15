begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_anonymous
) values (
  '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'integration@example.test', '', now(), '{}', '{"display_name":"Integration Owner"}', now(), now(), false
);
update public.profiles set handle = 'integration_owner' where id = '20000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}', true);
select lives_ok($$select public.create_room_with_invite('Atomic room')$$, 'room and invite creation succeeds atomically');
select is((select count(*)::integer from public.rooms where name = 'Atomic room'), 1, 'atomic room RPC creates one room');
select is((select count(*)::integer from public.room_invites where room_id = (select id from public.rooms where name = 'Atomic room')), 1, 'atomic room RPC creates exactly one invite');
select ok((select granted_to is null and max_uses = 9 from public.room_invites where room_id = (select id from public.rooms where name = 'Atomic room')), 'atomic invite is identity-neutral and multi-use');
select lives_ok(
  $$select public.create_and_start_countdown('personal', 'Atomic timer', 60, (select id from public.rooms where name = 'Atomic room'))$$,
  'countdown creation and start succeeds atomically'
);
select is((select state::text from public.countdowns where name = 'Atomic timer'), 'running', 'atomic countdown RPC leaves no idle timer');
select is((select color from public.countdowns where name = 'Atomic timer'), '#54d6d2', 'countdowns default to the current cyan color');
select lives_ok(
  $$select public.create_and_start_countdown('personal', 'Colored timer', 60, (select id from public.rooms where name = 'Atomic room'), 'creator_only', '{}', '#a78bfa')$$,
  'atomic countdown creation accepts a valid selected color'
);
select is((select color from public.countdowns where name = 'Colored timer'), '#a78bfa', 'selected countdown color persists');
select throws_ok(
  $$select public.create_and_start_countdown('personal', 'Invalid color timer', 60, (select id from public.rooms where name = 'Atomic room'), 'creator_only', '{}', 'purple')$$,
  '23514', 'new row for relation "countdowns" violates check constraint "countdowns_color_format"',
  'countdown colors must use the #RRGGBB format'
);
select is((select count(*)::integer from public.activity_events where subject_id = (select id from public.countdowns where name = 'Atomic timer') and event_type = 'countdown_created'), 1, 'countdown creation records one lifecycle event');
select is((select count(*)::integer from public.activity_events where subject_id = (select id from public.countdowns where name = 'Atomic timer') and event_type = 'countdown_running'), 1, 'countdown start records one lifecycle event');
reset role;
update public.countdowns
set started_at = started_at - interval '2 minutes', ends_at = ends_at - interval '2 minutes'
where name = 'Atomic timer';
set local role authenticated;
select is(public.finalize_elapsed_countdowns((select id from public.rooms where name = 'Atomic room')), 1, 'elapsed countdown finalization updates one timer');
select is((select state::text from public.countdowns where name = 'Atomic timer'), 'completed', 'elapsed countdown becomes completed');
select is(public.finalize_elapsed_countdowns((select id from public.rooms where name = 'Atomic room')), 0, 'elapsed countdown finalization is idempotent');
select is((select count(*)::integer from public.activity_events where subject_id = (select id from public.countdowns where name = 'Atomic timer') and event_type = 'countdown_completed'), 1, 'idempotent completion records exactly one activity event');

select * from finish();
rollback;
