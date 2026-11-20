-- Lock the dashboard's automatic-RLS event trigger function (decision A16).
--
-- When "Enable RLS on new tables automatically" is turned on in the Supabase
-- dashboard, the hosted project gets public.rls_auto_enable(), an
-- event_trigger function owned by postgres. It was created before the
-- baseline migration, so it kept PostgreSQL's default EXECUTE grant to PUBLIC
-- and was executable by anon. Event trigger functions cannot be called
-- directly, and the trigger is fired by the server, not by the caller, so
-- revoking EXECUTE from browser roles should not affect it. After applying,
-- confirm with supabase/checks/rls_auto_enable_still_works.sql.
--
-- Local and CI stacks do not have this function, hence the existence check.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
