-- Baseline privileges for Campaign Manager (decision A16).
--
-- The browser talks to the database as `anon` (signed out) or `authenticated`.
-- Nothing in `public` should be reachable by those roles unless a later migration
-- grants it explicitly, together with an RLS policy (tables) or an explicit
-- EXECUTE grant (functions). This migration removes the implicit grants so a
-- forgotten table or function is closed by default, both in the hosted project
-- and in local/CI stacks, whose defaults differ from the dashboard toggles.

-- 1. Tables and sequences created by migrations (role postgres) in public:
--    no automatic privileges for browser roles.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

-- 2. Functions: PostgreSQL grants EXECUTE to PUBLIC globally by default, and a
--    per-schema rule cannot remove a global grant. Revoke it globally for objects
--    created by postgres, and remove Supabase's per-schema grants to browser roles.
alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- 3. Private schema for helpers used inside RLS policies (for example
--    is_campaign_dm). It is not listed in the Data API schemas, so its functions
--    cannot be called over RPC. Usage is granted per helper in later migrations.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
comment on schema app_private is
  'Helpers for RLS policies and command functions. Never exposed through the Data API.';
