-- T05a: join requests, DM approval and the independent campaign copy
-- (AC-03, AC-04 join part; decisions A05, A06, A10-A12, A16).
--
-- request_join      a signed-in non-member asks to join a PUBLIC campaign with
--                   one of their characters (private and missing look the same)
-- join_request_preview  the DM (or requester) sees ONLY the shared fields that
--                   approval would copy, never notes or the PDF
-- decide_join       DM approves/rejects, requester cancels. Approval re-reads the
--                   source and, in one transaction, creates the membership, the
--                   campaign copy, the actor, its live state and an activity event.
--                   Repeating an approval returns the stored result.
--
-- The DM never gets read access to the player's personal tables (characters,
-- character_private, character_pdfs, storage). Copies are visible to the DM of
-- that campaign and the owning player only.
--
-- activity_events has no session column yet; T06 adds a nullable session_id
-- when sessions exist (A12).

-- HTTP-status errors through PostgREST's custom error form.
create function app_private.raise_http(p_code text, p_status integer)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise sqlstate 'PGRST' using
    message = format('{"code":"%s","message":"%s"}', p_code, p_code),
    detail  = format('{"status":%s,"headers":{}}', p_status);
end;
$$;
revoke all on function app_private.raise_http(text, integer) from public, anon, authenticated;

-- Tables ---------------------------------------------------------------------

create type public.join_request_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.actor_kind as enum ('player_character');

create table public.join_requests (
  id                    uuid primary key default gen_random_uuid(),
  campaign_id           uuid not null references public.campaigns (id) on delete cascade,
  requester_id          uuid not null references auth.users (id) on delete cascade,
  character_id          uuid not null references public.characters (id) on delete cascade,
  status                public.join_request_status not null default 'pending',
  decided_by            uuid references auth.users (id) on delete set null,
  decided_at            timestamptz,
  campaign_character_id uuid,
  actor_id              uuid,
  created_at            timestamptz not null default now()
);
create unique index join_requests_one_pending
  on public.join_requests (campaign_id, requester_id) where status = 'pending';
create index join_requests_campaign_idx on public.join_requests (campaign_id);
create index join_requests_requester_idx on public.join_requests (requester_id);

-- Campaign-specific copy of a character (A10). Base data only.
create table public.campaign_characters (
  id                  uuid primary key default gen_random_uuid(),
  campaign_id         uuid not null,
  user_id             uuid not null,
  source_character_id uuid references public.characters (id) on delete set null,
  name                text not null check (char_length(name) between 1 and 100),
  class               text check (class is null or char_length(class) between 1 and 60),
  level               integer check (level is null or level between 1 and 20),
  armor_class         integer check (armor_class is null or armor_class between 0 and 40),
  max_hp              integer not null check (max_hp between 1 and 999),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (campaign_id, user_id) references public.memberships (campaign_id, user_id) on delete cascade,
  unique (campaign_id, user_id),  -- one copy per player per campaign (pilot)
  unique (campaign_id, id)
);

-- Campaign-scoped identity (A10). Holds no content.
create table public.campaign_actors (
  id                    uuid primary key default gen_random_uuid(),
  campaign_id           uuid not null references public.campaigns (id) on delete cascade,
  kind                  public.actor_kind not null,
  campaign_character_id uuid unique,
  created_at            timestamptz not null default now(),
  foreign key (campaign_id, campaign_character_id)
    references public.campaign_characters (campaign_id, id) on delete cascade,
  check (kind <> 'player_character' or campaign_character_id is not null),
  unique (campaign_id, id)
);

-- Live values only (A11). Current HP unknown (null) until set in a session.
create table public.actor_state (
  actor_id         uuid primary key,
  campaign_id      uuid not null,
  effective_max_hp integer not null check (effective_max_hp between 1 and 999),
  current_hp       integer check (current_hp is null or current_hp between 0 and effective_max_hp),
  version          bigint not null default 1 check (version >= 1),
  updated_at       timestamptz not null default now(),
  foreign key (campaign_id, actor_id) references public.campaign_actors (campaign_id, id) on delete cascade
);

-- Immutable timeline (A12; session_id arrives in T06).
create table public.activity_events (
  id          bigint generated always as identity primary key,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  actor_id    uuid,
  author_id   uuid references auth.users (id) on delete set null,
  kind        text not null,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now(),
  foreign key (campaign_id, actor_id) references public.campaign_actors (campaign_id, id) on delete cascade
);
create index activity_events_campaign_idx on public.activity_events (campaign_id, id);

alter table public.join_requests enable row level security;
alter table public.campaign_characters enable row level security;
alter table public.campaign_actors enable row level security;
alter table public.actor_state enable row level security;
alter table public.activity_events enable row level security;

-- Read helpers ------------------------------------------------------------------

-- True when the caller is the player who owns this actor's campaign copy.
create function app_private.owns_actor(p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.campaign_actors a
      join public.campaign_characters cc on cc.id = a.campaign_character_id
     where a.id = p_actor and cc.user_id = (select auth.uid())
  );
$$;

-- The caller may see this user's profile: themself, a member of a campaign the
-- caller runs, or someone who asked to join one.
create function app_private.can_see_profile(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user = (select auth.uid())
      or exists (
        select 1 from public.memberships m
         where m.user_id = p_user
           and exists (select 1 from public.memberships d
                        where d.campaign_id = m.campaign_id
                          and d.user_id = (select auth.uid()) and d.role = 'dm'))
      or exists (
        select 1 from public.join_requests r
         where r.requester_id = p_user
           and exists (select 1 from public.memberships d
                        where d.campaign_id = r.campaign_id
                          and d.user_id = (select auth.uid()) and d.role = 'dm'));
$$;

revoke all on function app_private.owns_actor(uuid) from public, anon, authenticated;
revoke all on function app_private.can_see_profile(uuid) from public, anon, authenticated;
grant execute on function app_private.owns_actor(uuid) to authenticated;
grant execute on function app_private.can_see_profile(uuid) to authenticated;

-- Read policies -----------------------------------------------------------------

grant select on public.join_requests, public.campaign_characters, public.campaign_actors,
                public.actor_state, public.activity_events to authenticated;

create policy join_requests_select
  on public.join_requests for select to authenticated
  using (requester_id = (select auth.uid()) or (select app_private.is_campaign_dm(campaign_id)));

create policy campaign_characters_select
  on public.campaign_characters for select to authenticated
  using (user_id = (select auth.uid()) or (select app_private.is_campaign_dm(campaign_id)));

create policy campaign_actors_select
  on public.campaign_actors for select to authenticated
  using ((select app_private.is_campaign_dm(campaign_id)) or (select app_private.owns_actor(id)));

create policy actor_state_select
  on public.actor_state for select to authenticated
  using ((select app_private.is_campaign_dm(campaign_id)) or (select app_private.owns_actor(actor_id)));

create policy activity_events_select
  on public.activity_events for select to authenticated
  using (
    (select app_private.is_campaign_dm(campaign_id))
    or (actor_id is not null and (select app_private.owns_actor(actor_id)))
  );

-- The DM sees the whole roster of their campaign (players see only their own row).
create policy memberships_select_dm
  on public.memberships for select to authenticated
  using ((select app_private.is_campaign_dm(campaign_id)));

-- Names for the DM's roster and request list.
create policy profiles_select_related
  on public.profiles for select to authenticated
  using ((select app_private.can_see_profile(id)));

-- Commands ----------------------------------------------------------------------

create function public.request_join(p_campaign uuid, p_character uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_req  public.join_requests%rowtype;
begin
  if v_user is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  -- FOR SHARE serializes with set_campaign_visibility (FOR UPDATE).
  perform 1 from public.campaigns c
   where c.id = p_campaign and c.visibility = 'public'
   for share;
  if not found then
    perform app_private.raise_http('campaign_not_found', 404);
  end if;
  if exists (select 1 from public.memberships m where m.campaign_id = p_campaign and m.user_id = v_user) then
    perform app_private.raise_http('already_member', 409);
  end if;
  if not exists (select 1 from public.characters ch where ch.id = p_character and ch.owner_id = v_user) then
    perform app_private.raise_http('character_not_found', 404);
  end if;

  insert into public.join_requests (campaign_id, requester_id, character_id)
  values (p_campaign, v_user, p_character)
  on conflict (campaign_id, requester_id) where status = 'pending' do nothing;

  select * into v_req from public.join_requests
   where campaign_id = p_campaign and requester_id = v_user and status = 'pending';
  if v_req.character_id <> p_character then
    perform app_private.raise_http('request_pending', 409);
  end if;
  return v_req.id;
end;
$$;

create function public.join_request_preview(p_request uuid)
returns table (
  name text, class text, level integer, armor_class integer, max_hp integer, max_hp_missing boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_req public.join_requests%rowtype;
begin
  select * into v_req from public.join_requests where id = p_request;
  if not found
     or not (v_req.requester_id = (select auth.uid()) or app_private.is_campaign_dm(v_req.campaign_id)) then
    perform app_private.raise_http('request_not_found', 404);
  end if;

  return query
    select ch.name, ch.class, ch.level, ch.armor_class, ch.max_hp, ch.max_hp is null
      from public.characters ch
     where ch.id = v_req.character_id;
end;
$$;

create function public.decide_join(p_request uuid, p_decision text)
returns table (status public.join_request_status, campaign_character_id uuid, actor_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_req     public.join_requests%rowtype;
  v_src     public.characters%rowtype;
  v_cc      uuid;
  v_actor   uuid;
  v_is_dm   boolean;
begin
  if v_user is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject', 'cancel') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;

  select * into v_req from public.join_requests where id = p_request;
  if not found then
    perform app_private.raise_http('request_not_found', 404);
  end if;

  -- Lock order: campaign, then request.
  perform 1 from public.campaigns where id = v_req.campaign_id for update;
  select * into v_req from public.join_requests where id = p_request for update;

  v_is_dm := app_private.is_campaign_dm(v_req.campaign_id);
  if not v_is_dm and v_req.requester_id <> v_user then
    perform app_private.raise_http('request_not_found', 404);
  end if;
  if (p_decision in ('approve', 'reject') and not v_is_dm)
     or (p_decision = 'cancel' and v_req.requester_id <> v_user) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Repeating the same decision returns the stored result.
  if v_req.status <> 'pending' then
    if (p_decision = 'approve' and v_req.status = 'approved')
       or (p_decision = 'reject' and v_req.status = 'rejected')
       or (p_decision = 'cancel' and v_req.status = 'cancelled') then
      return query select v_req.status, v_req.campaign_character_id, v_req.actor_id;
      return;
    end if;
    perform app_private.raise_http('request_not_pending', 409);
  end if;

  if p_decision in ('reject', 'cancel') then
    update public.join_requests
       set status = case p_decision when 'reject' then 'rejected' else 'cancelled' end::public.join_request_status,
           decided_by = v_user, decided_at = now()
     where id = p_request;
    return query select r.status, null::uuid, null::uuid from public.join_requests r where r.id = p_request;
    return;
  end if;

  -- Approve: re-read the source at approval time.
  select * into v_src from public.characters
   where id = v_req.character_id and owner_id = v_req.requester_id;
  if not found then
    perform app_private.raise_http('character_not_found', 404);
  end if;
  if v_src.max_hp is null or v_src.max_hp < 1 then
    perform app_private.raise_http('max_hp_required', 409);
  end if;
  if exists (select 1 from public.memberships m
              where m.campaign_id = v_req.campaign_id and m.user_id = v_req.requester_id) then
    perform app_private.raise_http('already_member', 409);
  end if;

  insert into public.memberships (campaign_id, user_id, role)
  values (v_req.campaign_id, v_req.requester_id, 'player');

  insert into public.campaign_characters
    (campaign_id, user_id, source_character_id, name, class, level, armor_class, max_hp)
  values
    (v_req.campaign_id, v_req.requester_id, v_src.id, v_src.name, v_src.class, v_src.level,
     v_src.armor_class, v_src.max_hp)
  returning id into v_cc;

  insert into public.campaign_actors (campaign_id, kind, campaign_character_id)
  values (v_req.campaign_id, 'player_character', v_cc)
  returning id into v_actor;

  insert into public.actor_state (actor_id, campaign_id, effective_max_hp, current_hp)
  values (v_actor, v_req.campaign_id, v_src.max_hp, null);

  insert into public.activity_events (campaign_id, actor_id, author_id, kind, before, after)
  values (v_req.campaign_id, v_actor, v_user, 'join_approved', null,
          jsonb_build_object('name', v_src.name, 'effective_max_hp', v_src.max_hp, 'current_hp', null));

  update public.join_requests
     set status = 'approved', decided_by = v_user, decided_at = now(),
         campaign_character_id = v_cc, actor_id = v_actor
   where id = p_request;

  return query select 'approved'::public.join_request_status, v_cc, v_actor;
end;
$$;

revoke all on function public.request_join(uuid, uuid) from public, anon, authenticated;
revoke all on function public.join_request_preview(uuid) from public, anon, authenticated;
revoke all on function public.decide_join(uuid, text) from public, anon, authenticated;
grant execute on function public.request_join(uuid, uuid) to authenticated;
grant execute on function public.join_request_preview(uuid) to authenticated;
grant execute on function public.decide_join(uuid, text) to authenticated;
