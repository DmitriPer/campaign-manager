-- T02: one profile per signed-in user (decisions A03, A16).
--
-- A profile is created automatically when Supabase Auth creates a user (for
-- example on first Google sign-in). The email is deliberately NOT copied here:
-- in T03 campaign members will be able to read each other's profiles.

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at   timestamptz not null default now()
);

comment on table public.profiles is 'Public-facing user profile. No email or other private data.';

alter table public.profiles enable row level security;

-- Browser access: signed-in users read their own profile. No direct writes;
-- changes will go through database functions (A16).
grant select on public.profiles to authenticated;

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

-- Signup hook. Lives in app_private (not exposed through the Data API) and runs
-- with the owner's rights. It must never make signup fail, so every name source
-- has a fallback and an existing profile is left untouched.
create function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'משתמש'
  );

  insert into public.profiles (id, display_name)
  values (new.id, left(v_name, 80))
  on conflict (id) do nothing;

  return new;
end;
$$;

-- The auth service inserts users as supabase_auth_admin. Grant it exactly what
-- the trigger needs; browser roles get nothing in app_private.
revoke all on function app_private.handle_new_user() from public, anon, authenticated;
grant usage on schema app_private to supabase_auth_admin;
grant execute on function app_private.handle_new_user() to supabase_auth_admin;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function app_private.handle_new_user();
