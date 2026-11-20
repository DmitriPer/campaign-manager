-- T02: profiles are created on signup and each user sees only their own.
-- Three synthetic accounts: Alice and Bob (signed in), and a signed-out visitor.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

-- Create users the way Supabase Auth does: as supabase_auth_admin.
set local role supabase_auth_admin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'alice@example.test', '{"full_name": "Alice Example"}'),
  ('22222222-2222-4222-8222-222222222222', 'bob@example.test',   '{}'),
  ('33333333-3333-4333-8333-333333333333', 'carol@example.test', '{"name": "  "}');
reset role;

select is(
  (select display_name from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  'Alice Example',
  'signup creates a profile named from full_name'
);
select is(
  (select display_name from public.profiles where id = '22222222-2222-4222-8222-222222222222'),
  'bob',
  'without a name, the email prefix is used'
);
select is(
  (select display_name from public.profiles where id = '33333333-3333-4333-8333-333333333333'),
  'carol',
  'a blank name falls back to the email prefix'
);
select hasnt_column('public', 'profiles', 'email', 'profiles do not store the email');

-- Alice, signed in, sees only her own profile.
set local role authenticated;
set local request.jwt.claims = '{"sub": "11111111-1111-4111-8111-111111111111", "role": "authenticated"}';
select results_eq(
  'select id::text from public.profiles',
  $$ values ('11111111-1111-4111-8111-111111111111') $$,
  'a signed-in user sees only their own profile'
);
select throws_ok(
  $$ update public.profiles set display_name = 'hacked' $$,
  '42501',
  null,
  'a signed-in user cannot update profiles directly'
);
select throws_ok(
  $$ insert into public.profiles (id, display_name) values (gen_random_uuid(), 'x') $$,
  '42501',
  null,
  'a signed-in user cannot insert profiles directly'
);
select throws_ok(
  $$ delete from public.profiles $$,
  '42501',
  null,
  'a signed-in user cannot delete profiles directly'
);
reset role;

-- A signed-out visitor cannot read profiles at all.
set local role anon;
select throws_ok(
  'select count(*) from public.profiles',
  '42501',
  null,
  'a signed-out visitor cannot read profiles'
);
reset role;

-- Deleting the auth user removes the profile.
delete from auth.users where id = '22222222-2222-4222-8222-222222222222';
select is_empty(
  $$ select 1 from public.profiles where id = '22222222-2222-4222-8222-222222222222' $$,
  'deleting a user deletes their profile'
);

select * from finish();
rollback;
