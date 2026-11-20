-- T06a: sessions, live HP and effects, repeat-safe commands, history.
-- Single-connection rules here; true races are in tests/db/concurrency.mjs.
begin;
create extension if not exists pgtap with schema extensions;

select plan(40);

insert into auth.users (id, email, raw_user_meta_data) values
  ('d0000000-0000-4000-8000-00000000000d', 'dana@example.test',  '{"full_name": "Dana"}'),
  ('a0000000-0000-4000-8000-00000000000a', 'alice@example.test', '{"full_name": "Alice"}'),
  ('b0000000-0000-4000-8000-00000000000b', 'bob@example.test',   '{"full_name": "Bob"}'),
  ('e0000000-0000-4000-8000-00000000000e', 'eve@example.test',   '{"full_name": "Eve"}');

create temp table ctx (k text primary key, v text) on commit drop;
grant select, insert, update on ctx to authenticated;

-- Setup: Dana's public campaign with Alice and Bob approved.
set local role authenticated;
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-00000000000d", "role": "authenticated"}';
insert into ctx select 'camp', public.create_campaign('Live');
insert into ctx select 'vis', public.set_campaign_visibility((select v::uuid from ctx where k = 'camp'), 'public')::text;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-00000000000a", "role": "authenticated"}';
insert into ctx select 'a_char', public.save_character(null, 'Lyra', null, null, null, 18, null);
insert into ctx select 'a_req', public.request_join((select v::uuid from ctx where k = 'camp'), (select v::uuid from ctx where k = 'a_char'));
set local request.jwt.claims = '{"sub": "b0000000-0000-4000-8000-00000000000b", "role": "authenticated"}';
insert into ctx select 'b_char', public.save_character(null, 'Bram', null, null, null, 30, null);
insert into ctx select 'b_req', public.request_join((select v::uuid from ctx where k = 'camp'), (select v::uuid from ctx where k = 'b_char'));
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-00000000000d", "role": "authenticated"}';
insert into ctx select 'a_actor', d.actor_id from public.decide_join((select v::uuid from ctx where k = 'a_req'), 'approve') d;
insert into ctx select 'b_actor', d.actor_id from public.decide_join((select v::uuid from ctx where k = 'b_req'), 'approve') d;
reset role;

create function pg_temp.cmd(p_user text, p_session text, p_actor text, p_op text, p_command text, p_args jsonb)
returns jsonb language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  return public.actor_command(
    (select v::uuid from ctx where k = 'camp'), (select v::uuid from ctx where k = p_session),
    (select v::uuid from ctx where k = p_actor), p_op::uuid, p_command, p_args);
end $$;
grant execute on function pg_temp.cmd(text, text, text, text, text, jsonb) to authenticated;

-- Sessions: only the DM starts; numbering; one active.
set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-00000000000a", "role": "authenticated"}';
select throws_ok($$ select * from public.start_session((select v::uuid from ctx where k = 'camp')) $$,
  '42501', 'forbidden', 'a player cannot start a session');
set local request.jwt.claims = '{"sub": "e0000000-0000-4000-8000-00000000000e", "role": "authenticated"}';
select throws_ok($$ select * from public.start_session((select v::uuid from ctx where k = 'camp')) $$,
  'PGRST', '{"code":"campaign_not_found","message":"campaign_not_found"}', 'a non-member gets not-found');
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-00000000000d", "role": "authenticated"}';
insert into ctx select 's1', s.id from public.start_session((select v::uuid from ctx where k = 'camp')) s;
select is((select number from public.sessions where id = (select v::uuid from ctx where k = 's1')), 1, 'the first session is number 1');
select throws_ok($$ select * from public.start_session((select v::uuid from ctx where k = 'camp')) $$,
  'PGRST', '{"code":"session_active","message":"session_active"}', 'only one active session');
reset role;

-- HP starts unknown; damage on unknown HP is refused (unknown is not 0).
select throws_ok($$ select pg_temp.cmd('a0000000-0000-4000-8000-00000000000a', 's1', 'a_actor', '00000000-0000-4000-8000-000000000001', 'damage', '{"amount": 3}') $$,
  'PGRST', '{"code":"hp_unknown","message":"hp_unknown"}', 'damage on unknown HP is refused');
reset role;
select is((pg_temp.cmd('a0000000-0000-4000-8000-00000000000a', 's1', 'a_actor', '00000000-0000-4000-8000-000000000002', 'set_hp', '{"value": 18, "expected_version": 1}') ->> 'current_hp')::int,
  18, 'the owner enters the first HP');
reset role;
select is((pg_temp.cmd('d0000000-0000-4000-8000-00000000000d', 's1', 'a_actor', '00000000-0000-4000-8000-000000000003', 'damage', '{"amount": 3}') ->> 'current_hp')::int,
  15, 'the DM deals 3 damage');
reset role;
select is((pg_temp.cmd('a0000000-0000-4000-8000-00000000000a', 's1', 'a_actor', '00000000-0000-4000-8000-000000000004', 'damage', '{"amount": 4}') ->> 'current_hp')::int,
  11, 'the owner deals 4 more: 18 - 3 - 4 = 11');
reset role;

-- Repeat sends.
select is(pg_temp.cmd('d0000000-0000-4000-8000-00000000000d', 's1', 'a_actor', '00000000-0000-4000-8000-000000000003', 'damage', '{"amount": 3}') ->> 'replayed',
  'true', 'resending the same operation replays it');
reset role;
select is((select current_hp from public.actor_state where actor_id = (select v::uuid from ctx where k = 'a_actor')), 11,
  'a replay does not apply the damage again');
select is((select count(*)::int from public.activity_events where kind = 'damage'), 2, 'exactly two damage events');
select is(pg_temp.cmd('d0000000-0000-4000-8000-00000000000d', 's1', 'a_actor', '00000000-0000-4000-8000-000000000003', 'damage', '{"amount": 3.0}') ->> 'replayed',
  'true', '3.0 is the same command as 3 (validated fingerprint)');
reset role;
select throws_ok($$ select pg_temp.cmd('d0000000-0000-4000-8000-00000000000d', 's1', 'a_actor', '00000000-0000-4000-8000-000000000003', 'damage', '{"amount": 5}') $$,
  'PGRST', '{"code":"idempotency_conflict","message":"idempotency_conflict"}', 'the same id with a different command is refused');
reset role;

-- Absolute edits check the version.
select throws_ok($$ select pg_temp.cmd('a0000000-0000-4000-8000-00000000000a', 's1', 'a_actor', '00000000-0000-4000-8000-000000000005', 'set_hp', '{"value": 18, "expected_version": 2}') $$,
  'PGRST', '{"code":"version_conflict","message":"version_conflict"}', 'a set based on an old version is refused');
reset role;
select throws_ok($$ select pg_temp.cmd('a0000000-0000-4000-8000-00000000000a', 's1', 'a_actor', '00000000-0000-4000-8000-000000000006', 'set_hp', '{"value": 19, "expected_version": 4}') $$,
  '22023', 'invalid_hp', 'HP cannot exceed effective Max HP');
reset role;
select is((pg_temp.cmd('a0000000-0000-4000-8000-00000000000a', 's1', 'a_actor', '00000000-0000-4000-8000-000000000007', 'set_hp', '{"value": 0, "expected_version": 4}') ->> 'current_hp')::int,
  0, 'zero is a known value');
reset role;
select is((select current_hp from public.actor_state where actor_id = (select v::uuid from ctx where k = 'a_actor')), 0,
  'HP 0 is stored as 0, distinct from unknown');
select is((pg_temp.cmd('d0000000-0000-4000-8000-00000000000d', 's1', 'a_actor', '00000000-0000-4000-8000-000000000008', 'heal', '{"amount": 50}') ->> 'current_hp')::int,
  18, 'healing is capped at Max HP');
reset role;
select is((pg_temp.cmd('d0000000-0000-4000-8000-00000000000d', 's1', 'a_actor', '00000000-0000-4000-8000-000000000009', 'damage', '{"amount": 99}') ->> 'current_hp')::int,
  0, 'damage stops at 0');
reset role;

-- Input validation.
select throws_ok($$ select pg_temp.cmd('d0000000-0000-4000-8000-00000000000d', 's1', 'a_actor', '00000000-0000-4000-8000-000000000010', 'damage', '{"amount": 3.5}') $$,
  '22023', 'invalid_amount', 'a fractional amount is refused');
reset role;
select throws_ok($$ select pg_temp.cmd('d0000000-0000-4000-8000-00000000000d', 's1', 'a_actor', '00000000-0000-4000-8000-000000000011', 'damage', '{"amount": "3"}') $$,
  '22023', 'invalid_amount', 'a string amount is refused');
reset role;
select throws_ok($$ select pg_temp.cmd('d0000000-0000-4000-8000-00000000000d', 's1', 'a_actor', '00000000-0000-4000-8000-000000000012', 'explode', '{}') $$,
  '22023', 'invalid_command', 'an unknown command is refused');
reset role;

-- Effects: the specific one is removed, even with identical labels.
insert into ctx select 'eff1', pg_temp.cmd('d0000000-0000-4000-8000-00000000000d', 's1', 'a_actor', '00000000-0000-4000-8000-000000000013', 'add_effect', '{"label": " Poisoned "}') ->> 'effect_id';
reset role;
insert into ctx select 'eff2', pg_temp.cmd('a0000000-0000-4000-8000-00000000000a', 's1', 'a_actor', '00000000-0000-4000-8000-000000000014', 'add_effect', '{"label": "Poisoned"}') ->> 'effect_id';
reset role;
select ok(pg_temp.cmd('a0000000-0000-4000-8000-00000000000a', 's1', 'a_actor', '00000000-0000-4000-8000-000000000015', 'remove_effect',
  jsonb_build_object('effect_id', (select v from ctx where k = 'eff2'))) is not null, 'the owner removes one effect');
reset role;
select results_eq(
  $$ select id::text, label from public.actor_effects $$,
  $$ select (select v from ctx where k = 'eff1'), 'Poisoned' $$,
  'only the chosen effect is removed; the label was trimmed'
);
select throws_ok($$ select pg_temp.cmd('a0000000-0000-4000-8000-00000000000a', 's1', 'a_actor', '00000000-0000-4000-8000-000000000016', 'remove_effect',
  jsonb_build_object('effect_id', (select v from ctx where k = 'eff2'))) $$,
  'PGRST', '{"code":"effect_not_found","message":"effect_not_found"}', 'removing a missing effect is refused');
reset role;

-- Access: Bob cannot act on Alice's actor; Eve cannot act at all.
select throws_ok($$ select pg_temp.cmd('b0000000-0000-4000-8000-00000000000b', 's1', 'a_actor', '00000000-0000-4000-8000-000000000017', 'damage', '{"amount": 1}') $$,
  'PGRST', '{"code":"actor_not_found","message":"actor_not_found"}', 'another player cannot change Alice''s HP');
reset role;
select throws_ok($$ select pg_temp.cmd('e0000000-0000-4000-8000-00000000000e', 's1', 'a_actor', '00000000-0000-4000-8000-000000000018', 'damage', '{"amount": 1}') $$,
  'PGRST', '{"code":"actor_not_found","message":"actor_not_found"}', 'a non-member cannot change HP');
reset role;

-- Snapshot and history through RLS.
set local role authenticated;
set local request.jwt.claims = '{"sub": "b0000000-0000-4000-8000-00000000000b", "role": "authenticated"}';
select is(jsonb_array_length(public.play_snapshot((select v::uuid from ctx where k = 'camp')) -> 'actors'), 1,
  'a player''s snapshot contains only their own actor');
select is((select count(*)::int from public.session_activity((select v::uuid from ctx where k = 's1'))), 0,
  'a player sees no activity of other actors');
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-00000000000d", "role": "authenticated"}';
select is(jsonb_array_length(public.play_snapshot((select v::uuid from ctx where k = 'camp')) -> 'actors'), 2,
  'the DM''s snapshot contains every actor');
select is((select count(*)::int from public.session_activity((select v::uuid from ctx where k = 's1'), 0, 3)), 3,
  'history is paged');
set local request.jwt.claims = '{"sub": "e0000000-0000-4000-8000-00000000000e", "role": "authenticated"}';
select throws_ok($$ select public.play_snapshot((select v::uuid from ctx where k = 'camp')) $$,
  'PGRST', '{"code":"campaign_not_found","message":"campaign_not_found"}', 'a non-member gets no snapshot');
select throws_ok('select 1 from public.command_receipts', '42501', null, 'receipts are not readable');
reset role;

-- End: state persists; old session refuses new commands; replay still works.
set local role authenticated;
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-00000000000d", "role": "authenticated"}';
select ok((select ended_at is not null from public.end_session((select v::uuid from ctx where k = 'camp'), (select v::uuid from ctx where k = 's1'))),
  'the DM ends the session');
insert into ctx select 's2', s.id from public.start_session((select v::uuid from ctx where k = 'camp')) s;
select is((select number from public.sessions where id = (select v::uuid from ctx where k = 's2')), 2, 'the next session is number 2');
reset role;
select results_eq(
  $$ select current_hp, (select count(*)::int from public.actor_effects) from public.actor_state where actor_id = (select v::uuid from ctx where k = 'a_actor') $$,
  $$ values (0, 1) $$,
  'HP and effects are exactly as at the end of the previous session'
);
select throws_ok($$ select pg_temp.cmd('d0000000-0000-4000-8000-00000000000d', 's1', 'a_actor', '00000000-0000-4000-8000-000000000019', 'heal', '{"amount": 1}') $$,
  'PGRST', '{"code":"session_not_active","message":"session_not_active"}', 'a command for the old session is refused while a new one is active');
reset role;
select is(pg_temp.cmd('d0000000-0000-4000-8000-00000000000d', 's1', 'a_actor', '00000000-0000-4000-8000-000000000009', 'damage', '{"amount": 99}') ->> 'replayed',
  'true', 'a lost-response retry after the end still gets its stored result');
reset role;
select is((select count(*)::int from public.activity_events where session_id = (select v::uuid from ctx where k = 's1') and kind = 'session_ended'), 1,
  'the end is logged once');
select throws_ok(
  $$ insert into public.activity_events (campaign_id, kind) values ((select v::uuid from ctx where k = 'camp'), 'damage') $$,
  '23514', null, 'a live-state event without a session is impossible'
);

select * from finish();
rollback;
