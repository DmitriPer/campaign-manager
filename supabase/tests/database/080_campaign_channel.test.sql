-- T07a: campaign channel authorization and database-originated signals.
-- realtime.messages rows are what Realtime delivers after commit; here we count
-- them inside the test transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email, raw_user_meta_data) values
  ('d0000000-0000-4000-8000-00000000000d', 'dana@example.test',  '{"full_name": "Dana"}'),
  ('a0000000-0000-4000-8000-00000000000a', 'alice@example.test', '{"full_name": "Alice"}'),
  ('c0000000-0000-4000-8000-00000000000c', 'pat@example.test',   '{"full_name": "Pat"}'),
  ('e0000000-0000-4000-8000-00000000000e', 'eve@example.test',   '{"full_name": "Eve"}');

create temp table ctx (k text primary key, v text) on commit drop;
grant select, insert on ctx to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-00000000000d", "role": "authenticated"}';
insert into ctx select 'camp', public.create_campaign('Signals');
insert into ctx select 'vis', public.set_campaign_visibility((select v::uuid from ctx where k = 'camp'), 'public')::text;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-00000000000a", "role": "authenticated"}';
insert into ctx select 'a_char', public.save_character(null, 'Lyra', null, null, null, 18, null);
insert into ctx select 'a_req', public.request_join((select v::uuid from ctx where k = 'camp'), (select v::uuid from ctx where k = 'a_char'));
set local request.jwt.claims = '{"sub": "c0000000-0000-4000-8000-00000000000c", "role": "authenticated"}';
insert into ctx select 'p_char', public.save_character(null, 'Pat', null, null, null, 8, null);
insert into ctx select 'p_req', public.request_join((select v::uuid from ctx where k = 'camp'), (select v::uuid from ctx where k = 'p_char'));
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-00000000000d", "role": "authenticated"}';
insert into ctx select 'actor', d.actor_id from public.decide_join((select v::uuid from ctx where k = 'a_req'), 'approve') d;
insert into ctx select 's1', s.id from public.start_session((select v::uuid from ctx where k = 'camp')) s;
reset role;

insert into ctx select 'topic', 'campaign:' || (select v from ctx where k = 'camp');

select policies_are('realtime', 'messages',
  array['user_channel_receive_own', 'campaign_channel_receive_member'],
  'realtime.messages has exactly the two receive policies');

-- Each statement above ran in this one transaction, so the dedupe setting is
-- shared. Measure signals per command by clearing it and counting deltas.
create function pg_temp.campaign_signals() returns integer language sql as $$
  select count(*)::int from realtime.messages
   where topic = (select v from ctx where k = 'topic') and private and event = 'changed'
$$;
create function pg_temp.reset_dedupe() returns text language sql as $$
  select set_config('cm_signal.c' || replace((select v from ctx where k = 'camp'), '-', ''), '', true)
$$;

select ok(pg_temp.campaign_signals() >= 1, 'joining and starting a session produced a campaign signal');

-- A command sends exactly one signal, even when it touches two tables.
insert into ctx select 'dedupe0', pg_temp.reset_dedupe();
insert into ctx select 'n0', pg_temp.campaign_signals()::text;
set local role authenticated;
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-00000000000d", "role": "authenticated"}';
insert into ctx select 'r1', public.actor_command((select v::uuid from ctx where k = 'camp'), (select v::uuid from ctx where k = 's1'),
  (select v::uuid from ctx where k = 'actor'), '00000000-0000-4000-8000-000000000001', 'add_effect', '{"label": "Blessed"}')::text;
reset role;
select is(pg_temp.campaign_signals() - (select v::int from ctx where k = 'n0'), 1,
  'an effect command (two tables) sends exactly one signal');
select is(
  (select payload - 'id' from realtime.messages where topic = (select v from ctx where k = 'topic') order by inserted_at desc, id desc limit 1),
  '{"kind": "changed"}'::jsonb,
  'the signal carries no game data');

-- A failing command sends nothing.
insert into ctx select 'dedupe1', pg_temp.reset_dedupe();
insert into ctx select 'n1', pg_temp.campaign_signals()::text;
set local role authenticated;
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-00000000000d", "role": "authenticated"}';
select throws_ok(
  $$ select public.actor_command((select v::uuid from ctx where k = 'camp'), (select v::uuid from ctx where k = 's1'),
       (select v::uuid from ctx where k = 'actor'), '00000000-0000-4000-8000-000000000002', 'damage', '{"amount": 1}') $$,
  'PGRST', '{"code":"hp_unknown","message":"hp_unknown"}', 'a damage on unknown HP fails');
reset role;
select is(pg_temp.campaign_signals() - (select v::int from ctx where k = 'n1'), 0, 'a failed command sends no signal');

-- A replay sends nothing.
insert into ctx select 'dedupe2', pg_temp.reset_dedupe();
insert into ctx select 'n2', pg_temp.campaign_signals()::text;
set local role authenticated;
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-00000000000d", "role": "authenticated"}';
select is(public.actor_command((select v::uuid from ctx where k = 'camp'), (select v::uuid from ctx where k = 's1'),
  (select v::uuid from ctx where k = 'actor'), '00000000-0000-4000-8000-000000000001', 'add_effect', '{"label": "Blessed"}') ->> 'replayed',
  'true', 'the same operation is replayed');
reset role;
select is(pg_temp.campaign_signals() - (select v::int from ctx where k = 'n2'), 0, 'a replay sends no signal');

-- A join request signals the requester's own channel too.
select ok(exists (select 1 from realtime.messages where topic = 'user:c0000000-0000-4000-8000-00000000000c'),
  'a join request signals the requester''s user channel');

-- Authorization: Realtime evaluates the policy with realtime.topic() set.
set local role authenticated;
insert into ctx select 'topic_set', set_config('realtime.topic', (select v from ctx where k = 'topic'), true);
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-00000000000d", "role": "authenticated"}';
select ok((select count(*) from realtime.messages) > 0, 'the DM is authorized on the campaign channel');
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-00000000000a", "role": "authenticated"}';
select ok((select count(*) from realtime.messages) > 0, 'a player is authorized on the campaign channel');
set local request.jwt.claims = '{"sub": "c0000000-0000-4000-8000-00000000000c", "role": "authenticated"}';
select is((select count(*)::int from realtime.messages), 0, 'a pending requester is not authorized');
set local request.jwt.claims = '{"sub": "e0000000-0000-4000-8000-00000000000e", "role": "authenticated"}';
select is((select count(*)::int from realtime.messages), 0, 'a non-member is not authorized');
set local realtime.topic = 'campaign:not-a-uuid';
select lives_ok('select count(*) from realtime.messages', 'a malformed topic is refused without an error');
reset role;

select * from finish();
rollback;
