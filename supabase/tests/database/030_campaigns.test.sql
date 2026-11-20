-- T03 / AC-01: campaigns, DM membership, visibility and the public profile.
-- Alice creates a campaign; Bob is another signed-in user; a visitor is anon.
begin;
create extension if not exists pgtap with schema extensions;

select plan(25);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'alice@example.test', '{"full_name": "Alice"}'),
  ('22222222-2222-4222-8222-222222222222', 'bob@example.test',   '{"full_name": "Bob"}');

create temp table ctx (campaign uuid) on commit drop;
grant select, insert on ctx to authenticated, anon;

-- A visitor cannot create campaigns.
set local role anon;
select throws_ok(
  $$ select public.create_campaign('X') $$, '42501', null,
  'a visitor cannot create a campaign'
);
reset role;

-- Alice creates a campaign.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}';
insert into ctx select public.create_campaign('  קמפיין הבדיקה  ', 'תיאור קצר');
select is((select count(*)::int from ctx where campaign is not null), 1, 'create_campaign returns an id');

select throws_ok($$ select public.create_campaign('   ') $$, '22023', 'invalid_name',
  'an empty name is rejected');
select throws_ok($$ select public.create_campaign(repeat('א', 101)) $$, '22023', 'invalid_name',
  'a name over 100 characters is rejected');
select throws_ok($$ select public.create_campaign('ok', repeat('א', 2001)) $$, '22023', 'invalid_description',
  'a description over 2000 characters is rejected');

select results_eq(
  'select name, description, visibility::text from public.campaigns',
  $$ values ('קמפיין הבדיקה', 'תיאור קצר', 'private') $$,
  'Alice sees her campaign: trimmed name, private by default'
);
select results_eq(
  'select role::text from public.memberships where campaign_id = (select campaign from ctx)',
  $$ values ('dm') $$,
  'the creator becomes the DM'
);
select throws_ok(
  $$ update public.campaigns set name = 'hacked' $$, '42501', null,
  'no direct update of campaigns'
);
select throws_ok(
  $$ insert into public.memberships (campaign_id, user_id, role)
     select campaign, '22222222-2222-4222-8222-222222222222', 'player' from ctx $$, '42501', null,
  'no direct insert into memberships'
);
reset role;

-- Private: Bob and the visitor learn nothing.
set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}';
select is_empty('select 1 from public.campaigns', 'Bob cannot read Alice''s private campaign');
select is_empty('select 1 from public.memberships', 'Bob sees no memberships');
select is_empty(
  'select * from public.public_campaign_profile((select campaign from ctx))',
  'a private campaign has no public profile'
);
select throws_ok(
  $$ select public.set_campaign_visibility((select campaign from ctx), 'public') $$,
  'PGRST', '{"code":"campaign_not_found","message":"campaign_not_found"}',
  'a non-member cannot change visibility and does not learn the campaign exists'
);
reset role;

set local role anon;
select is_empty(
  'select * from public.public_campaign_profile((select campaign from ctx))',
  'a visitor gets nothing for a private campaign'
);
select is_empty(
  $$ select * from public.public_campaign_profile('99999999-9999-4999-8999-999999999999') $$,
  'a missing campaign looks the same as a private one'
);
select throws_ok('select 1 from public.campaigns', '42501', null,
  'a visitor cannot read the campaigns table');
reset role;

-- Alice publishes.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}';
select throws_ok(
  $$ select public.set_campaign_visibility((select campaign from ctx), 'secret') $$,
  '22023', 'invalid_visibility',
  'an unknown visibility is rejected'
);
select is(
  public.set_campaign_visibility((select campaign from ctx), 'public')::text,
  'public',
  'the DM can publish'
);
reset role;

-- Public: only name and description, for anyone.
set local role anon;
select results_eq(
  'select name, description from public.public_campaign_profile((select campaign from ctx))',
  $$ values ('קמפיין הבדיקה', 'תיאור קצר') $$,
  'a visitor sees name and description of a public campaign'
);
reset role;

select is(
  (select string_agg(a, ',' order by o)
     from pg_proc p,
          unnest(p.proargnames, p.proargmodes::text[]) with ordinality as x(a, m, o)
    where p.proname = 'public_campaign_profile' and x.m = 't'),
  'name,description',
  'the public profile returns exactly name and description'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "22222222-2222-4222-8222-222222222222", "role": "authenticated"}';
select is_empty('select 1 from public.campaigns',
  'publishing does not let Bob read the campaigns table');
select is(
  (select count(*)::int from public.public_campaign_profile((select campaign from ctx))),
  1,
  'Bob sees the public profile'
);
reset role;

-- Back to private: the public profile disappears, the DM keeps access.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}';
select is(
  public.set_campaign_visibility((select campaign from ctx), 'private')::text,
  'private',
  'the DM can make it private again'
);
select is((select count(*)::int from public.campaigns), 1, 'the DM still sees the campaign');
reset role;

set local role anon;
select is_empty(
  'select * from public.public_campaign_profile((select campaign from ctx))',
  'after making it private, visitors see nothing'
);
reset role;

select * from finish();
rollback;
