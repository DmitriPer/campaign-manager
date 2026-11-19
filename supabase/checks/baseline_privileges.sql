-- Docker-free check of the baseline-privileges migration on a hosted project.
-- Paste into the Supabase dashboard SQL Editor and run. Read-only.
-- Expected: tables_without_rls = 0, anon_executable_functions = 0,
--           app_private_exists = true, anon_can_use_app_private = false,
--           baseline_migration_applied = true
select
  (select count(*)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity)
    as tables_without_rls,
  (select count(*)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute'))
    as anon_executable_functions,
  exists (select 1 from pg_namespace where nspname = 'app_private')
    as app_private_exists,
  coalesce(has_schema_privilege('anon', 'app_private', 'usage'), false)
    as anon_can_use_app_private,
  exists (select 1 from supabase_migrations.schema_migrations
           where version = '20261119200000')
    as baseline_migration_applied;
