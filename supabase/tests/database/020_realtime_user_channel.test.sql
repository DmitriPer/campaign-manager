-- T02b: private user channels. Checks the RLS policy that Realtime uses to
-- authorize joins, without needing the Realtime server (that is covered by
-- tests/realtime/user-channel.mjs in CI).
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'alice@example.test', '{"full_name": "Alice"}'),
  ('22222222-2222-4222-8222-222222222222', 'bob@example.test',   '{"full_name": "Bob"}');

select policies_are(
  'realtime', 'messages',
  array['user_channel_receive_own'],
  'realtime.messages has only the own-user-channel policy'
);

select ok(has_function_privilege('authenticated', 'public.realtime_self_test()', 'execute'),
  'signed-in users can run the self-test');
select ok(not has_function_privilege('anon', 'public.realtime_self_test()', 'execute'),
  'signed-out visitors cannot run the self-test');

-- Alice sends a signal to herself.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}';
select lives_ok('select public.realtime_self_test()', 'Alice can send a self-test signal');
reset role;

select is(
  (select count(*)::int from realtime.messages
    where topic = 'user:11111111-1111-4111-8111-111111111111' and private),
  1,
  'the signal is stored on Alice''s private topic'
);
select is(
  (select payload - 'id' from realtime.messages
    where topic = 'user:11111111-1111-4111-8111-111111111111' limit 1),
  '{"kind": "changed", "probe": true}'::jsonb,
  'the payload carries no game data'
);

-- Realtime evaluates the policy with realtime.topic() set to the requested topic.
-- Alice may read her own topic.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}';
set local realtime.topic = 'user:11111111-1111-4111-8111-111111111111';
select is(
  (select count(*)::int from realtime.messages),
  1,
  'Alice is authorized on her own channel'
);

-- Bob asks for Alice's topic: nothing is visible, so the join is refused.
set local request.jwt.claims = '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}';
set local realtime.topic = 'user:11111111-1111-4111-8111-111111111111';
select is(
  (select count(*)::int from realtime.messages),
  0,
  'Bob is not authorized on Alice''s channel'
);

-- Clients cannot send on private channels (no INSERT policy).
select throws_ok(
  $$ insert into realtime.messages (topic, extension, event, payload, private)
     values ('user:22222222-2222-4222-8222-222222222222', 'broadcast', 'x', '{}', true) $$,
  '42501',
  null,
  'a signed-in user cannot send on a private channel'
);
reset role;

select * from finish();
rollback;
