-- Confirms the dashboard's automatic-RLS trigger still fires after
-- 20261119210000_lock_rls_auto_enable.sql. Paste into the SQL Editor and run.
-- Creates a throwaway table and drops it again in the same run.
-- Expected: rls_enabled = true
create table public.__rls_auto_enable_probe (id int);
select relrowsecurity as rls_enabled
  from pg_class
 where oid = 'public.__rls_auto_enable_probe'::regclass;
drop table public.__rls_auto_enable_probe;
