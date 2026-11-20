-- T05a: join requests, approval, independent campaign copies (AC-03) and the
-- join part of AC-04. Dana runs campaigns A and B; Alice plays; Mallory is a
-- different user; the visitor is anon.
begin;
create extension if not exists pgtap with schema extensions;

select plan(36);

insert into auth.users (id, email, raw_user_meta_data) values
  ('d0000000-0000-4000-8000-00000000000d', 'dana@example.test',    '{"full_name": "Dana DM"}'),
  ('a0000000-0000-4000-8000-00000000000a', 'alice@example.test',   '{"full_name": "Alice"}'),
  ('e0000000-0000-4000-8000-00000000000e', 'mallory@example.test', '{"full_name": "Mallory"}');

create temp table ctx (k text primary key, v text) on commit drop;
grant select, insert, update on ctx to authenticated, anon;

-- Dana creates two campaigns; A is public, B stays private for now.
set local role authenticated;
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-00000000000d", "role": "authenticated"}';
insert into ctx select 'A', public.create_campaign('Campaign A');
insert into ctx select 'B', public.create_campaign('Campaign B');
select is(public.set_campaign_visibility((select v::uuid from ctx where k = 'A'), 'public')::text, 'public', 'campaign A is public');

-- Alice has a character without Max HP, and Mallory one of her own.
set local request.jwt.claims = '{"sub": "e0000000-0000-4000-8000-00000000000e", "role": "authenticated"}';
insert into ctx select 'mal_char', public.save_character(null, 'Mal', null, null, null, 10, null);
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-00000000000a", "role": "authenticated"}';
insert into ctx select 'lyra', public.save_character(null, 'Lyra', 'Ranger', 3, 15, null, 'private notes');

-- Requests.
select throws_ok(
  $$ select public.request_join((select v::uuid from ctx where k = 'B'), (select v::uuid from ctx where k = 'lyra')) $$,
  'PGRST', '{"code":"campaign_not_found","message":"campaign_not_found"}',
  'a private campaign does not accept requests and looks missing'
);
select throws_ok(
  $$ select public.request_join((select v::uuid from ctx where k = 'A'), (select v::uuid from ctx where k = 'mal_char')) $$,
  'PGRST', '{"code":"character_not_found","message":"character_not_found"}',
  'Alice cannot request with someone else''s character'
);
insert into ctx select 'req', public.request_join((select v::uuid from ctx where k = 'A'), (select v::uuid from ctx where k = 'lyra'));
select is(
  public.request_join((select v::uuid from ctx where k = 'A'), (select v::uuid from ctx where k = 'lyra')),
  (select v::uuid from ctx where k = 'req'),
  'requesting again with the same character returns the same request'
);
select results_eq(
  $$ select name, class, level, armor_class, max_hp, max_hp_missing
       from public.join_request_preview((select v::uuid from ctx where k = 'req')) $$,
  $$ values ('Lyra'::text, 'Ranger'::text, 3, 15, null::integer, true) $$,
  'the requester sees the preview, including that Max HP is missing'
);
select throws_ok(
  $$ select * from public.decide_join((select v::uuid from ctx where k = 'req'), 'approve') $$,
  '42501', 'forbidden',
  'the requester cannot approve their own request'
);
reset role;

-- Dana reviews.
set local role authenticated;
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-00000000000d", "role": "authenticated"}';
select is((select count(*)::int from public.join_requests), 1, 'the DM sees the request to her campaign');
select is((select display_name from public.profiles where id = 'a0000000-0000-4000-8000-00000000000a'),
  'Alice', 'the DM sees the requester''s name');
select results_eq(
  $$ select name, max_hp_missing from public.join_request_preview((select v::uuid from ctx where k = 'req')) $$,
  $$ values ('Lyra'::text, true) $$,
  'the DM sees the shared fields'
);
select is_empty('select 1 from public.characters where owner_id <> auth.uid()',
  'the DM cannot read the player''s personal characters');
select is_empty('select 1 from public.character_private',
  'the DM cannot read the player''s private notes');
select throws_ok(
  $$ select * from public.decide_join((select v::uuid from ctx where k = 'req'), 'approve') $$,
  'PGRST', '{"code":"max_hp_required","message":"max_hp_required"}',
  'approval requires a positive Max HP'
);
reset role;

-- Alice fills in Max HP; Dana approves (twice).
set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-00000000000a", "role": "authenticated"}';
select ok(public.save_character((select v::uuid from ctx where k = 'lyra'), 'Lyra', 'Ranger', 3, 15, 24, 'private notes') is not null,
  'the player completes Max HP');
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-00000000000d", "role": "authenticated"}';
insert into ctx select 'approve1', row(d.*)::text from public.decide_join((select v::uuid from ctx where k = 'req'), 'approve') d;
insert into ctx select 'approve2', row(d.*)::text from public.decide_join((select v::uuid from ctx where k = 'req'), 'approve') d;
select is((select v from ctx where k = 'approve2'), (select v from ctx where k = 'approve1'),
  'approving again returns the same membership copy and actor');
select is((select count(*)::int from public.memberships where campaign_id = (select v::uuid from ctx where k = 'A')), 2,
  'exactly one player membership was added');
select results_eq(
  $$ select name, class, level, armor_class, max_hp from public.campaign_characters $$,
  $$ values ('Lyra'::text, 'Ranger'::text, 3, 15, 24) $$,
  'the copy holds the shared fields at approval time'
);
select results_eq(
  $$ select effective_max_hp, current_hp, version from public.actor_state $$,
  $$ values (24, null::integer, 1::bigint) $$,
  'live state starts with current HP unknown'
);
select is((select kind from public.activity_events), 'join_approved', 'the approval is logged');
select throws_ok(
  $$ select * from public.decide_join((select v::uuid from ctx where k = 'req'), 'reject') $$,
  'PGRST', '{"code":"request_not_pending","message":"request_not_pending"}',
  'a decided request cannot be decided differently'
);
reset role;

-- Alice now sees her copy and state; Mallory and the visitor see nothing.
set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-00000000000a", "role": "authenticated"}';
select is((select count(*)::int from public.campaign_characters), 1, 'the player sees her campaign copy');
select is((select count(*)::int from public.actor_state), 1, 'the player sees her live state');
select is((select count(*)::int from public.memberships where campaign_id = (select v::uuid from ctx where k = 'A')), 1,
  'a player sees only her own membership');
select throws_ok(
  $$ select public.request_join((select v::uuid from ctx where k = 'A'), (select v::uuid from ctx where k = 'lyra')) $$,
  'PGRST', '{"code":"already_member","message":"already_member"}',
  'a member cannot request again'
);
set local request.jwt.claims = '{"sub": "e0000000-0000-4000-8000-00000000000e", "role": "authenticated"}';
select is_empty('select 1 from public.campaign_characters', 'another user sees no campaign copies');
select is_empty('select 1 from public.actor_state', 'another user sees no live state');
select is_empty('select 1 from public.activity_events', 'another user sees no activity');
select is_empty('select 1 from public.join_requests', 'another user sees no requests');
select throws_ok(
  $$ select * from public.join_request_preview((select v::uuid from ctx where k = 'req')) $$,
  'PGRST', '{"code":"request_not_found","message":"request_not_found"}',
  'another user cannot preview the request'
);
select throws_ok(
  $$ update public.actor_state set current_hp = 0 $$, '42501', null,
  'nobody writes live state directly'
);
reset role;

set local role anon;
select throws_ok('select 1 from public.campaign_characters', '42501', null, 'a visitor cannot read copies');
select throws_ok('select 1 from public.join_requests', '42501', null, 'a visitor cannot read requests');
reset role;

-- AC-03: the same character joins campaign B; copies stay independent.
set local role authenticated;
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-00000000000d", "role": "authenticated"}';
select is(public.set_campaign_visibility((select v::uuid from ctx where k = 'B'), 'public')::text, 'public', 'campaign B is published');
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-00000000000a", "role": "authenticated"}';
insert into ctx select 'reqB', public.request_join((select v::uuid from ctx where k = 'B'), (select v::uuid from ctx where k = 'lyra'));
set local request.jwt.claims = '{"sub": "d0000000-0000-4000-8000-00000000000d", "role": "authenticated"}';
insert into ctx select 'approveB', row(d.*)::text from public.decide_join((select v::uuid from ctx where k = 'reqB'), 'approve') d;
reset role;

select is(
  (select count(distinct id)::int from public.campaign_characters where source_character_id = (select v::uuid from ctx where k = 'lyra')),
  2,
  'each campaign has its own copy of the character'
);

-- A change in copy A (as T06 commands will make) leaves copy B and the source alone.
update public.campaign_characters set level = 4
 where campaign_id = (select v::uuid from ctx where k = 'A');
select results_eq(
  $$ select (select level from public.campaign_characters where campaign_id = (select v::uuid from ctx where k = 'B')),
            (select level from public.characters where id = (select v::uuid from ctx where k = 'lyra')) $$,
  $$ values (3, 3) $$,
  'changing one copy does not change the other copy or the source'
);

-- Editing the source after approval does not change the copies.
set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-00000000000a", "role": "authenticated"}';
select ok(public.save_character((select v::uuid from ctx where k = 'lyra'), 'Lyra', 'Ranger', 5, 15, 30, '') is not null,
  'the player edits the source');
reset role;
select results_eq(
  $$ select max_hp from public.campaign_characters order by campaign_id $$,
  $$ values (24), (24) $$,
  'editing the source does not change existing copies'
);

select * from finish();
rollback;
