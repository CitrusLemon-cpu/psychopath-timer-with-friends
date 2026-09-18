begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_anonymous
)
values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fixed-end@example.test', '', now(), '{}', '{}', now(), now(), false);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}', true);
select lives_ok($$update public.profiles set handle = 'fixed_end_user', display_name = 'Fixed End User' where id = auth.uid()$$, 'user completes a profile');
select lives_ok($$select public.create_room('Fixed end room')$$, 'user creates a room');
select lives_ok(
  $$select public.create_and_start_countdown_v2('personal', 'Deadline', 3600, (select id from public.rooms where name = 'Fixed end room'), 'creator_only', '{}'::uuid[], '#54d6d2', true)$$,
  'user creates a running fixed-end countdown'
);
select ok((select fixed_end from public.countdowns where name = 'Deadline'), 'the fixed-end marker is persisted');
select throws_ok(
  $$select public.control_countdown((select id from public.countdowns where name = 'Deadline'), 'pause')$$,
  '22023', 'fixed-end countdown cannot be paused', 'fixed-end countdowns reject pause requests'
);
select lives_ok(
  $$select public.create_and_start_countdown_v2('personal', 'Duration', 3600, (select id from public.rooms where name = 'Fixed end room'), 'creator_only', '{}'::uuid[], '#54d6d2', false)$$,
  'user creates a duration countdown'
);
select lives_ok(
  $$select public.control_countdown((select id from public.countdowns where name = 'Duration'), 'pause')$$,
  'duration countdowns remain pausable'
);

select * from finish();
rollback;
