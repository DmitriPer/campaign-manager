-- T07a: live "changed" signals on a private campaign channel (A17; AC-04, AC-07).
--
-- Members (DM and players) may join the private topic 'campaign:<id>'. The
-- DATABASE sends a content-free signal whenever campaign play data changes;
-- clients then re-read through RLS (play_snapshot etc.). Clients cannot send.
--
-- Signals come from statement-level triggers, so the command functions stay
-- unchanged. realtime.send writes a message that Realtime delivers only after the
-- transaction commits: a rolled-back command sends nothing, and a replay writes
-- nothing, so it sends nothing. At most one signal per campaign per transaction.
--
-- What a member learns: that something in the campaign changed, never what.
-- Join request changes also signal the requester's own user channel.
-- If realtime.messages has no partition (Realtime idle), the signal is dropped
-- with a warning; clients reconcile periodically (T07b).

create policy campaign_channel_receive_member
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    -- CASE guarantees the pattern is checked before the uuid cast, so a malformed
    -- topic evaluates to false instead of raising inside the policy.
    and case
          when (select realtime.topic()) ~* '^campaign:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (select app_private.is_campaign_member(substr((select realtime.topic()), 10)::uuid))
          else false
        end
  );

-- Sends one "changed" signal per campaign per transaction.
create function app_private.signal_campaign(p_campaign uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := 'cm_signal.c' || replace(p_campaign::text, '-', '');
begin
  if p_campaign is null or coalesce(current_setting(v_key, true), '') = '1' then
    return;
  end if;
  perform set_config(v_key, '1', true);
  perform realtime.send(jsonb_build_object('kind', 'changed'), 'changed', 'campaign:' || p_campaign::text, true);
end;
$$;

create function app_private.signal_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is not null then
    perform realtime.send(jsonb_build_object('kind', 'changed'), 'changed', 'user:' || p_user::text, true);
  end if;
end;
$$;

-- Statement-level trigger body: one signal per distinct campaign in the rows.
-- Transition tables are named "changed" on every trigger that uses this.
create function app_private.on_campaign_rows_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign uuid;
begin
  for v_campaign in select distinct c.campaign_id from changed c loop
    perform app_private.signal_campaign(v_campaign);
  end loop;
  return null;
end;
$$;

create function app_private.on_join_requests_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  for v_row in select distinct c.campaign_id, c.requester_id from changed c loop
    perform app_private.signal_campaign(v_row.campaign_id);
    perform app_private.signal_user(v_row.requester_id);
  end loop;
  return null;
end;
$$;

revoke all on function app_private.signal_campaign(uuid) from public, anon, authenticated;
revoke all on function app_private.signal_user(uuid) from public, anon, authenticated;
revoke all on function app_private.on_campaign_rows_changed() from public, anon, authenticated;
revoke all on function app_private.on_join_requests_changed() from public, anon, authenticated;

-- One trigger per event (transition tables cannot span events).
create trigger actor_state_signal_insert after insert on public.actor_state
  referencing new table as changed for each statement execute function app_private.on_campaign_rows_changed();
create trigger actor_state_signal_update after update on public.actor_state
  referencing new table as changed for each statement execute function app_private.on_campaign_rows_changed();

create trigger actor_effects_signal_insert after insert on public.actor_effects
  referencing new table as changed for each statement execute function app_private.on_campaign_rows_changed();
create trigger actor_effects_signal_delete after delete on public.actor_effects
  referencing old table as changed for each statement execute function app_private.on_campaign_rows_changed();

create trigger sessions_signal_insert after insert on public.sessions
  referencing new table as changed for each statement execute function app_private.on_campaign_rows_changed();
create trigger sessions_signal_update after update on public.sessions
  referencing new table as changed for each statement execute function app_private.on_campaign_rows_changed();

create trigger memberships_signal_insert after insert on public.memberships
  referencing new table as changed for each statement execute function app_private.on_campaign_rows_changed();

create trigger join_requests_signal_insert after insert on public.join_requests
  referencing new table as changed for each statement execute function app_private.on_join_requests_changed();
create trigger join_requests_signal_update after update on public.join_requests
  referencing new table as changed for each statement execute function app_private.on_join_requests_changed();
