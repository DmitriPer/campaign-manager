-- T06a: sessions, live HP and effects, repeat-safe commands and history
-- (AC-05, AC-06, AC-08; decisions A05, A11-A13, A17, P06).
--
-- Lock order everywhere: campaign -> session -> actor.
--   start_session  campaign FOR UPDATE; one active session; number from
--                  next_session_number
--   end_session    campaign FOR UPDATE, session FOR UPDATE; ended_at uses
--                  clock_timestamp(); state is NOT reset
--   actor_command  session FOR SHARE (by id only, then checks status), actor
--                  FOR UPDATE. A command that committed before end_session took
--                  its lock is kept; one that waited behind it gets 409.
--
-- Repeat sends (P06): each command carries an operation id. The receipt is
-- reserved first (INSERT ... ON CONFLICT DO NOTHING): a concurrent duplicate waits
-- on the unique key, then returns the stored result. The fingerprint is built
-- from VALIDATED values; the same id with a different command is 409. Only
-- successes are stored (a failure rolls back the receipt too). A replay is
-- answered even after the session ended, if the caller still has access.
-- Receipts older than 7 days are deleted when a session starts.
--
-- Reads (play_snapshot, session_activity) are SECURITY INVOKER: existing RLS
-- decides what each caller sees.

-- Sessions --------------------------------------------------------------------

create type public.session_status as enum ('active', 'ended');

create table public.sessions (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  number      integer not null check (number >= 1),
  status      public.session_status not null default 'active',
  started_at  timestamptz not null default clock_timestamp(),
  ended_at    timestamptz,
  started_by  uuid references auth.users (id) on delete set null,
  ended_by    uuid references auth.users (id) on delete set null,
  unique (campaign_id, number),
  unique (campaign_id, id),
  check ((status = 'ended') = (ended_at is not null))
);
create unique index sessions_one_active on public.sessions (campaign_id) where status = 'active';

alter table public.sessions enable row level security;
grant select on public.sessions to authenticated;
create policy sessions_select_member
  on public.sessions for select to authenticated
  using ((select app_private.is_campaign_member(campaign_id)));

-- Activity events get their session (A12).
alter table public.activity_events add column session_id uuid;
alter table public.activity_events
  add constraint activity_events_session_fk
  foreign key (campaign_id, session_id) references public.sessions (campaign_id, id) on delete cascade;
alter table public.activity_events
  add constraint activity_events_live_need_session
  check (kind not in ('damage', 'heal', 'set_hp', 'add_effect', 'remove_effect') or session_id is not null);
create index activity_events_session_idx on public.activity_events (session_id, id);

-- Effects (A13) ------------------------------------------------------------------

create table public.actor_effects (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  actor_id    uuid not null,
  label       text not null check (char_length(label) between 1 and 60 and label = btrim(label)),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  foreign key (campaign_id, actor_id) references public.campaign_actors (campaign_id, id) on delete cascade
);
create index actor_effects_actor_idx on public.actor_effects (actor_id, created_at);

alter table public.actor_effects enable row level security;
grant select on public.actor_effects to authenticated;
create policy actor_effects_select
  on public.actor_effects for select to authenticated
  using ((select app_private.is_campaign_dm(campaign_id)) or (select app_private.owns_actor(actor_id)));

-- Receipts: only the functions touch them (no grants, RLS on, no policies).
create table public.command_receipts (
  user_id      uuid not null,
  operation_id uuid not null,
  fingerprint  text not null,
  result       jsonb not null,
  campaign_id  uuid,
  actor_id     uuid,
  created_at   timestamptz not null default now(),
  primary key (user_id, operation_id)
);
create index command_receipts_created_idx on public.command_receipts (created_at);
alter table public.command_receipts enable row level security;

-- Session lifecycle ----------------------------------------------------------------

create function public.start_session(p_campaign uuid)
returns table (id uuid, number integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := auth.uid();
  v_number integer;
  v_id     uuid;
begin
  if v_user is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  select c.next_session_number into v_number
    from public.campaigns c where c.id = p_campaign for update;
  if not found or not app_private.is_campaign_member(p_campaign) then
    perform app_private.raise_http('campaign_not_found', 404);
  end if;
  if not app_private.is_campaign_dm(p_campaign) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from public.sessions s where s.campaign_id = p_campaign and s.status = 'active') then
    perform app_private.raise_http('session_active', 409);
  end if;

  update public.campaigns set next_session_number = v_number + 1, updated_at = now()
   where campaigns.id = p_campaign;
  insert into public.sessions (campaign_id, number, started_by)
  values (p_campaign, v_number, v_user)
  returning sessions.id into v_id;
  insert into public.activity_events (campaign_id, session_id, author_id, kind, after)
  values (p_campaign, v_id, v_user, 'session_started', jsonb_build_object('number', v_number));

  -- Receipt retention: a week is far longer than any retry window.
  delete from public.command_receipts where created_at < now() - interval '7 days';

  return query select v_id, v_number;
end;
$$;

create function public.end_session(p_campaign uuid, p_session uuid)
returns table (id uuid, number integer, ended_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_s    public.sessions%rowtype;
begin
  if v_user is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  perform 1 from public.campaigns c where c.id = p_campaign for update;
  if not found or not app_private.is_campaign_member(p_campaign) then
    perform app_private.raise_http('campaign_not_found', 404);
  end if;
  select * into v_s from public.sessions s where s.id = p_session for update;
  if not found or v_s.campaign_id <> p_campaign then
    perform app_private.raise_http('session_not_found', 404);
  end if;
  if not app_private.is_campaign_dm(p_campaign) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_s.status = 'active' then
    update public.sessions
       set status = 'ended', ended_at = clock_timestamp(), ended_by = v_user
     where sessions.id = p_session
    returning * into v_s;
    insert into public.activity_events (campaign_id, session_id, author_id, kind, after)
    values (p_campaign, p_session, v_user, 'session_ended', jsonb_build_object('number', v_s.number));
  end if;

  return query select v_s.id, v_s.number, v_s.ended_at;
end;
$$;

-- Live commands ----------------------------------------------------------------------

create function public.actor_command(
  p_campaign  uuid,
  p_session   uuid,
  p_actor     uuid,
  p_operation uuid,
  p_command   text,
  p_args      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := auth.uid();
  v_norm     jsonb;
  v_fp       text;
  v_receipt  public.command_receipts%rowtype;
  v_reserved boolean;
  v_session  public.sessions%rowtype;
  v_state    public.actor_state%rowtype;
  v_num      numeric;
  v_amount   integer;
  v_value    integer;
  v_expected bigint;
  v_label    text;
  v_effect   uuid;
  v_new_hp   integer;
  v_before   jsonb;
  v_after    jsonb;
  v_result   jsonb;
begin
  if v_user is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if p_operation is null then
    raise exception 'invalid_operation' using errcode = '22023';
  end if;
  p_args := coalesce(p_args, '{}'::jsonb);

  -- 1. Validate and normalize (the fingerprint uses these values).
  case p_command
    when 'damage', 'heal' then
      if jsonb_typeof(p_args -> 'amount') <> 'number' then
        raise exception 'invalid_amount' using errcode = '22023';
      end if;
      v_num := (p_args ->> 'amount')::numeric;
      if v_num <> trunc(v_num) or v_num not between 1 and 999 then
        raise exception 'invalid_amount' using errcode = '22023';
      end if;
      v_amount := v_num::integer;
      v_norm := jsonb_build_object('amount', v_amount);
    when 'set_hp' then
      if jsonb_typeof(p_args -> 'value') <> 'number' or jsonb_typeof(p_args -> 'expected_version') <> 'number' then
        raise exception 'invalid_hp' using errcode = '22023';
      end if;
      v_num := (p_args ->> 'value')::numeric;
      if v_num <> trunc(v_num) or v_num not between 0 and 999 then
        raise exception 'invalid_hp' using errcode = '22023';
      end if;
      v_value := v_num::integer;
      v_num := (p_args ->> 'expected_version')::numeric;
      if v_num <> trunc(v_num) or v_num < 1 then
        raise exception 'invalid_hp' using errcode = '22023';
      end if;
      v_expected := v_num::bigint;
      v_norm := jsonb_build_object('value', v_value, 'expected_version', v_expected);
    when 'add_effect' then
      if jsonb_typeof(p_args -> 'label') <> 'string' then
        raise exception 'invalid_label' using errcode = '22023';
      end if;
      v_label := btrim(p_args ->> 'label');
      if char_length(v_label) not between 1 and 60 then
        raise exception 'invalid_label' using errcode = '22023';
      end if;
      v_norm := jsonb_build_object('label', v_label);
    when 'remove_effect' then
      if jsonb_typeof(p_args -> 'effect_id') <> 'string'
         or (p_args ->> 'effect_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'invalid_effect' using errcode = '22023';
      end if;
      v_effect := (p_args ->> 'effect_id')::uuid;
      v_norm := jsonb_build_object('effect_id', v_effect);
    else
      raise exception 'invalid_command' using errcode = '22023';
  end case;

  -- 2. Access: the DM or the actor's owner, actor in this campaign.
  if not exists (select 1 from public.campaign_actors a where a.id = p_actor and a.campaign_id = p_campaign)
     or not (app_private.is_campaign_dm(p_campaign) or app_private.owns_actor(p_actor)) then
    perform app_private.raise_http('actor_not_found', 404);
  end if;

  -- 3. Reserve the receipt; a duplicate returns the stored result.
  v_fp := md5(jsonb_build_object(
    'campaign', p_campaign, 'session', p_session, 'actor', p_actor,
    'command', p_command, 'args', v_norm)::text);
  insert into public.command_receipts (user_id, operation_id, fingerprint, result)
  values (v_user, p_operation, v_fp, '{}'::jsonb)
  on conflict (user_id, operation_id) do nothing
  returning true into v_reserved;
  if v_reserved is null then
    select * into v_receipt from public.command_receipts
     where user_id = v_user and operation_id = p_operation;
    if v_receipt.fingerprint <> v_fp then
      perform app_private.raise_http('idempotency_conflict', 409);
    end if;
    return v_receipt.result || jsonb_build_object('replayed', true);
  end if;

  -- 4. Session: lock by id only, then check (see header).
  select * into v_session from public.sessions s where s.id = p_session for share;
  if not found or v_session.campaign_id <> p_campaign then
    perform app_private.raise_http('session_not_found', 404);
  end if;
  if v_session.status <> 'active' then
    perform app_private.raise_http('session_not_active', 409);
  end if;

  -- 5. Actor state.
  select * into v_state from public.actor_state st where st.actor_id = p_actor for update;
  v_before := jsonb_build_object('current_hp', v_state.current_hp, 'version', v_state.version);
  v_new_hp := v_state.current_hp;

  case p_command
    when 'damage', 'heal' then
      if v_state.current_hp is null then
        perform app_private.raise_http('hp_unknown', 409);
      end if;
      v_new_hp := case p_command
        when 'damage' then greatest(0, v_state.current_hp - v_amount)
        else least(v_state.effective_max_hp, v_state.current_hp + v_amount) end;
    when 'set_hp' then
      if v_expected <> v_state.version then
        perform app_private.raise_http('version_conflict', 409);
      end if;
      if v_value > v_state.effective_max_hp then
        raise exception 'invalid_hp' using errcode = '22023';
      end if;
      v_new_hp := v_value;
    when 'add_effect' then
      insert into public.actor_effects (campaign_id, actor_id, label, created_by)
      values (p_campaign, p_actor, v_label, v_user)
      returning actor_effects.id into v_effect;
      v_before := v_before || jsonb_build_object('effect', null);
    when 'remove_effect' then
      delete from public.actor_effects e
       where e.id = v_effect and e.actor_id = p_actor
      returning e.label into v_label;
      if v_label is null then
        perform app_private.raise_http('effect_not_found', 404);
      end if;
      v_before := v_before || jsonb_build_object('effect', jsonb_build_object('id', v_effect, 'label', v_label));
  end case;

  update public.actor_state
     set current_hp = v_new_hp, version = version + 1, updated_at = now()
   where actor_id = p_actor
  returning * into v_state;

  v_after := jsonb_build_object('current_hp', v_state.current_hp, 'version', v_state.version);
  if p_command = 'add_effect' then
    v_after := v_after || jsonb_build_object('effect', jsonb_build_object('id', v_effect, 'label', v_label));
  end if;

  insert into public.activity_events (campaign_id, session_id, actor_id, author_id, kind, before, after)
  values (p_campaign, p_session, p_actor, v_user, p_command, v_before, v_after || v_norm);

  v_result := jsonb_build_object(
    'actor_id', p_actor,
    'current_hp', v_state.current_hp,
    'effective_max_hp', v_state.effective_max_hp,
    'version', v_state.version,
    'effect_id', case when p_command in ('add_effect', 'remove_effect') then v_effect end);

  update public.command_receipts
     set result = v_result, campaign_id = p_campaign, actor_id = p_actor
   where user_id = v_user and operation_id = p_operation;

  return v_result || jsonb_build_object('replayed', false);
end;
$$;

-- Reads (SECURITY INVOKER: RLS decides) ------------------------------------------------

create function public.play_snapshot(p_campaign uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not app_private.is_campaign_member(p_campaign) then
    raise sqlstate 'PGRST' using
      message = '{"code":"campaign_not_found","message":"campaign_not_found"}',
      detail  = '{"status":404,"headers":{}}';
  end if;

  return jsonb_build_object(
    'campaign_id', p_campaign,
    'session', (
      select jsonb_build_object('id', s.id, 'number', s.number, 'started_at', s.started_at)
        from public.sessions s where s.campaign_id = p_campaign and s.status = 'active'),
    'last_session_number', (select max(s.number) from public.sessions s where s.campaign_id = p_campaign),
    'actors', coalesce((
      select jsonb_agg(jsonb_build_object(
               'actor_id', a.id,
               'name', cc.name,
               'class', cc.class,
               'user_id', cc.user_id,
               'effective_max_hp', st.effective_max_hp,
               'current_hp', st.current_hp,
               'version', st.version,
               'effects', coalesce((
                 select jsonb_agg(jsonb_build_object('id', e.id, 'label', e.label) order by e.created_at, e.id)
                   from public.actor_effects e where e.actor_id = a.id), '[]'::jsonb))
             order by cc.name, a.id)
        from public.campaign_actors a
        join public.campaign_characters cc on cc.id = a.campaign_character_id
        join public.actor_state st on st.actor_id = a.id
       where a.campaign_id = p_campaign), '[]'::jsonb)
  );
end;
$$;

create function public.session_activity(p_session uuid, p_after bigint default 0, p_limit integer default 100)
returns table (
  id bigint, kind text, actor_id uuid, author_id uuid, before jsonb, after jsonb, created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.id, e.kind, e.actor_id, e.author_id, e.before, e.after, e.created_at
    from public.activity_events e
   where e.session_id = p_session and e.id > coalesce(p_after, 0)
   order by e.id
   limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

revoke all on function public.start_session(uuid) from public, anon, authenticated;
revoke all on function public.end_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.actor_command(uuid, uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.play_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.session_activity(uuid, bigint, integer) from public, anon, authenticated;
grant execute on function public.start_session(uuid) to authenticated;
grant execute on function public.end_session(uuid, uuid) to authenticated;
grant execute on function public.actor_command(uuid, uuid, uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.play_snapshot(uuid) to authenticated;
grant execute on function public.session_activity(uuid, bigint, integer) to authenticated;
