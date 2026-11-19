-- Guard tests for decision A16. They pass with zero app tables and keep
-- protecting every later migration: a new table without RLS, or a function
-- callable by anonymous users, fails CI.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

-- Every table in public has Row Level Security enabled.
select is_empty(
  $$ select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
        and not c.relrowsecurity $$,
  'every table in public has RLS enabled'
);

-- No function in public is executable by anon (allowlist is empty for now;
-- public_campaign_profile will be the first deliberate exception in T03).
select is_empty(
  $$ select p.oid::regprocedure::text
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and has_function_privilege('anon', p.oid, 'execute')
        and p.proname not in (select unnest(array[]::text[])) $$,
  'no function in public is executable by anon'
);

-- Behavioral checks: objects created now (as a migration would) get no
-- implicit privileges for browser roles.
create table public.__guard_table (id int primary key);
create function public.__guard_fn() returns int language sql as 'select 1';

select ok(not has_table_privilege('anon', 'public.__guard_table', 'select'),
  'new table: anon cannot select');
select ok(not has_table_privilege('authenticated', 'public.__guard_table', 'select'),
  'new table: authenticated cannot select');
select ok(not has_table_privilege('authenticated', 'public.__guard_table', 'insert'),
  'new table: authenticated cannot insert');
select ok(not has_function_privilege('anon', 'public.__guard_fn()', 'execute'),
  'new function: anon cannot execute');
select ok(not has_function_privilege('authenticated', 'public.__guard_fn()', 'execute'),
  'new function: authenticated cannot execute until granted');

-- The helper schema exists and browser roles cannot use it by default.
select ok(not has_schema_privilege('anon', 'app_private', 'usage'),
  'app_private is not usable by anon');

select * from finish();
rollback;
