-- Guard tests for decision A16. They pass with zero app tables and keep
-- protecting every later migration: a new table without RLS, or a function
-- callable by anonymous users, fails CI.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

-- No table, view or materialized view in public grants anything to anon.
select is_empty(
  $$ select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p', 'v', 'm')
        and has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger') $$,
  'anon has no privileges on any relation in public'
);

-- Signed-in users never write tables directly; writes go through functions (A16).
select is_empty(
  $$ select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p', 'v', 'm')
        and has_table_privilege('authenticated', c.oid, 'insert, update, delete, truncate') $$,
  'authenticated cannot insert, update, delete or truncate any relation in public'
);

-- Views must evaluate RLS as the caller, never as the view owner.
select is_empty(
  $$ select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'v'
        and not coalesce(c.reloptions @> array['security_invoker=true'], false) $$,
  'every view in public uses security_invoker'
);

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

-- No function in public is executable by anon, except this allowlist of exact
-- signatures (an overload with the same name is NOT allowed implicitly).
select is_empty(
  $$ select p.oid::regprocedure::text
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and has_function_privilege('anon', p.oid, 'execute')
        and p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' not in (
          'public_campaign_profile(p_campaign uuid)'
        ) $$,
  'no function in public is executable by anon, except the allowlist'
);

-- Every SECURITY DEFINER function in app schemas pins its search_path.
select is_empty(
  $$ select p.oid::regprocedure::text
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app_private')
        and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') $$,
  'every SECURITY DEFINER function sets search_path'
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
