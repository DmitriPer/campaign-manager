-- T02b: Realtime authorization spike (decision A17).
--
-- Proves the mechanism live play will use: the DATABASE sends a minimal
-- "changed" signal on a PRIVATE channel, and Realtime only lets a client join
-- that channel when an RLS policy on realtime.messages allows it. Here the
-- channel is per user (topic 'user:<uid>'); campaign channels in T03/T07 will
-- use the same mechanism with a membership check instead.
--
-- Browsers can only receive: there is no INSERT policy, so clients cannot send
-- on private channels. Payloads carry no game data.

-- Receive (and join) only your own user channel.
create policy user_channel_receive_own
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'user:' || (select auth.uid())::text
  );

-- Connection self-test: sends a content-free "changed" signal to the caller's
-- own channel. The topic comes from the caller's identity, never from input.
create function public.realtime_self_test()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'sign-in required' using errcode = '42501';
  end if;

  perform realtime.send(
    jsonb_build_object('kind', 'changed', 'probe', true),
    'changed',
    'user:' || v_user::text,
    true
  );
end;
$$;

comment on function public.realtime_self_test() is
  'Sends a content-free changed signal to the caller''s private user channel. Diagnostic for Realtime authorization (T02b).';

revoke all on function public.realtime_self_test() from public, anon, authenticated;
grant execute on function public.realtime_self_test() to authenticated;
