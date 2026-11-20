-- T03: campaigns, memberships and the public profile (AC-01; decisions A05, A16).
--
-- Reads:   members read their campaigns; each user reads their own memberships.
-- Writes:  only through functions (create_campaign, set_campaign_visibility).
-- Public:  public_campaign_profile(uuid) is the ONLY entry point for visitors and
--          returns name + description of a public campaign, nothing else. A private
--          and a nonexistent campaign give the same empty result.
--
-- Error identifiers (raised as the message, mapped to Hebrew in the app):
--   auth_required (42501), invalid_name / invalid_description / invalid_visibility (22023),
--   campaign_not_found (SQLSTATE 'PGRST' with HTTP 404, see below), forbidden (42501).
-- PostgREST has no 404 mapping for a plain SQLSTATE, so campaign_not_found uses its
-- custom-error form: SQLSTATE 'PGRST', a JSON message and a JSON detail with the status.

create type public.campaign_visibility as enum ('private', 'public');
create type public.campaign_role as enum ('dm', 'player');

create table public.campaigns (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users (id) on delete restrict,
  name                text not null check (char_length(name) between 1 and 100 and name = btrim(name)),
  description         text not null default '' check (char_length(description) <= 2000),
  visibility          public.campaign_visibility not null default 'private',
  next_session_number integer not null default 1 check (next_session_number >= 1),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.memberships (
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.campaign_role not null,
  created_at  timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

create index memberships_user_idx on public.memberships (user_id);

alter table public.campaigns enable row level security;
alter table public.memberships enable row level security;

-- Helpers for policies. SECURITY DEFINER avoids policy recursion on memberships;
-- they live in app_private, which the Data API does not expose.
create function app_private.is_campaign_member(p_campaign uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
     where m.campaign_id = p_campaign and m.user_id = (select auth.uid())
  );
$$;

create function app_private.is_campaign_dm(p_campaign uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
     where m.campaign_id = p_campaign and m.user_id = (select auth.uid()) and m.role = 'dm'
  );
$$;

revoke all on function app_private.is_campaign_member(uuid) from public, anon, authenticated;
revoke all on function app_private.is_campaign_dm(uuid) from public, anon, authenticated;
grant usage on schema app_private to authenticated;
grant execute on function app_private.is_campaign_member(uuid) to authenticated;
grant execute on function app_private.is_campaign_dm(uuid) to authenticated;

-- Browser read access.
grant select on public.campaigns to authenticated;
grant select on public.memberships to authenticated;

create policy campaigns_select_member
  on public.campaigns for select to authenticated
  using ((select app_private.is_campaign_member(id)));

create policy memberships_select_own
  on public.memberships for select to authenticated
  using (user_id = (select auth.uid()));

-- Commands -------------------------------------------------------------------

create function public.create_campaign(p_name text, p_description text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_id uuid;
begin
  if v_user is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 100 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if char_length(v_description) > 2000 then
    raise exception 'invalid_description' using errcode = '22023';
  end if;

  insert into public.campaigns (owner_id, name, description)
  values (v_user, v_name, v_description)
  returning id into v_id;

  insert into public.memberships (campaign_id, user_id, role)
  values (v_id, v_user, 'dm');

  return v_id;
end;
$$;

create function public.set_campaign_visibility(p_campaign uuid, p_visibility text)
returns public.campaign_visibility
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_visibility public.campaign_visibility;
begin
  if v_user is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if p_visibility is null or p_visibility not in ('private', 'public') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;
  v_visibility := p_visibility::public.campaign_visibility;

  -- Lock the campaign row; also serializes with later approval/session commands.
  perform 1 from public.campaigns where id = p_campaign for update;
  if not found or not app_private.is_campaign_member(p_campaign) then
    raise sqlstate 'PGRST' using
      message = '{"code":"campaign_not_found","message":"campaign_not_found"}',
      detail  = '{"status":404,"headers":{}}';
  end if;
  if not app_private.is_campaign_dm(p_campaign) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.campaigns
     set visibility = v_visibility, updated_at = now()
   where id = p_campaign;

  return v_visibility;
end;
$$;

-- The only visitor-facing read. Same empty result for private and missing.
create function public.public_campaign_profile(p_campaign uuid)
returns table (name text, description text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.name, c.description
    from public.campaigns c
   where c.id = p_campaign and c.visibility = 'public';
$$;

revoke all on function public.create_campaign(text, text) from public, anon, authenticated;
revoke all on function public.set_campaign_visibility(uuid, text) from public, anon, authenticated;
revoke all on function public.public_campaign_profile(uuid) from public, anon, authenticated;
grant execute on function public.create_campaign(text, text) to authenticated;
grant execute on function public.set_campaign_visibility(uuid, text) to authenticated;
grant execute on function public.public_campaign_profile(uuid) to anon, authenticated;
