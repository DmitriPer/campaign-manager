#!/usr/bin/env node
// T07a live check against a LOCAL Supabase stack (CI): the private campaign
// channel with real users and the real Realtime server. Covers who may join
// (AC-04 stream part), delivery within 2 s (AC-07 target), no game data in the
// signal, no signal for a failed command, and catching up after a reconnect.
//
// Required env (from `supabase status -o env`): API_URL, and ANON_KEY or
// PUBLISHABLE_KEY, and SERVICE_ROLE_KEY or SECRET_KEY. Never point this at a
// hosted project: it creates users with the admin API.
import { createClient } from '@supabase/supabase-js';

const url = process.env.API_URL;
const publicKey = process.env.PUBLISHABLE_KEY || process.env.ANON_KEY;
const adminKey = process.env.SECRET_KEY || process.env.SERVICE_ROLE_KEY;
if (!url || !publicKey || !adminKey) {
  console.error('Missing API_URL / ANON_KEY|PUBLISHABLE_KEY / SERVICE_ROLE_KEY|SECRET_KEY');
  process.exit(2);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
  console.error(`Refusing to run against a non-local URL: ${url}`);
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'ok    ' : 'not ok'} - ${name}${detail ? ` (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

const admin = createClient(url, adminKey, opts);
const stamp = Date.now();

async function makeUser(name) {
  const email = `${name}.${stamp}@example.test`;
  const password = `pw-${stamp}-${name}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error) throw new Error(`createUser ${name}: ${error.message}`);
  const client = createClient(url, publicKey, opts);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn ${name}: ${signInError.message}`);
  await client.realtime.setAuth();
  return { id: data.user.id, client };
}

/** Subscribes to a private topic; resolves with the final status and a message log. */
function join_(client, topic) {
  const received = [];
  return new Promise((resolve) => {
    const channel = client.channel(topic, { config: { private: true } });
    channel.on('broadcast', { event: 'changed' }, (msg) => received.push(msg));
    const timer = setTimeout(() => resolve({ status: 'TIMED_OUT', channel, received }), 10000);
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
        clearTimeout(timer);
        resolve({ status, error: err?.message, channel, received });
      }
    });
  });
}

let exitCode = 0;
try {
  const dana = await makeUser('dana');
  const alice = await makeUser('alice');
  const bob = await makeUser('bob');
  const pat = await makeUser('pat');
  const eve = await makeUser('eve');
  const visitor = createClient(url, publicKey, opts);

  const camp = (await dana.client.rpc('create_campaign', { p_name: 'Live channel' })).data;
  await dana.client.rpc('set_campaign_visibility', { p_campaign: camp, p_visibility: 'public' });
  const join = async (u, name, maxHp, approve) => {
    const ch = (await u.client.rpc('save_character', {
      p_id: null, p_name: name, p_class: null, p_level: null, p_armor_class: null, p_max_hp: maxHp, p_notes: null,
    })).data;
    const req = (await u.client.rpc('request_join', { p_campaign: camp, p_character: ch })).data;
    if (!approve) return null;
    const r = await dana.client.rpc('decide_join', { p_request: req, p_decision: 'approve' });
    return r.data[0].actor_id;
  };
  const aliceActor = await join(alice, 'Lyra', 18, true);
  const bobActor = await join(bob, 'Bram', 30, true);
  await join(pat, 'Pat', 8, false);
  const session = (await dana.client.rpc('start_session', { p_campaign: camp })).data[0].id;
  const cmd = (u, actor, command, args) =>
    u.client.rpc('actor_command', {
      p_campaign: camp, p_session: session, p_actor: actor, p_operation: crypto.randomUUID(), p_command: command, p_args: args,
    });
  await cmd(alice, aliceActor, 'set_hp', { value: 18, expected_version: 1 });

  const topic = `campaign:${camp}`;
  const danaCh = await join_(dana.client, topic);
  const aliceCh = await join_(alice.client, topic);
  const bobCh = await join_(bob.client, topic);
  check('The DM joins the campaign channel', danaCh.status === 'SUBSCRIBED', danaCh.status);
  check('A player joins the campaign channel', aliceCh.status === 'SUBSCRIBED', aliceCh.status);
  check('Another player joins too', bobCh.status === 'SUBSCRIBED', bobCh.status);
  for (const [who, client] of [['A pending requester', pat.client], ['A non-member', eve.client], ['A visitor', visitor]]) {
    const r = await join_(client, topic);
    check(`${who} is refused on the campaign channel`, r.status !== 'SUBSCRIBED', `${r.status}${r.error ? `: ${r.error}` : ''}`);
  }

  // AC-07 target: the player sees the DM's change within 2 seconds.
  const sentAt = Date.now();
  const add = await cmd(dana, aliceActor, 'add_effect', { label: 'Blessed' });
  check('The DM adds an effect', !add.error, add.error?.message ?? '');
  for (let i = 0; i < 40 && aliceCh.received.length === 0; i++) await sleep(50);
  const latency = Date.now() - sentAt;
  check('AC-07: the player receives the signal within 2 s', aliceCh.received.length >= 1 && latency < 2000, `${latency} ms`);
  const payload = aliceCh.received[0]?.payload ?? {};
  check('The signal carries no game data', payload.kind === 'changed' && Object.keys(payload).every((k) => ['kind', 'id'].includes(k)), JSON.stringify(payload));
  await sleep(300);
  check('One command sends one signal', aliceCh.received.length === 1, `${aliceCh.received.length} signals`);

  // AC-04 (stream part): another member is signalled but still sees nothing of Alice.
  check('Another member also receives the content-free signal', bobCh.received.length >= 1);
  const bobView = await bob.client.rpc('play_snapshot', { p_campaign: camp });
  check("Another member's snapshot still shows nothing of Alice", !bobView.error && bobView.data.actors.every((a) => a.actor_id !== aliceActor), JSON.stringify(bobView.data?.actors?.map((a) => a.name)));

  // A failed command sends nothing.
  const before = aliceCh.received.length;
  const failed = await cmd(dana, bobActor, 'damage', { amount: 1 });
  await sleep(1500);
  check('A failed command sends no signal', !!failed.error && aliceCh.received.length === before, `${failed.error?.message} / ${aliceCh.received.length - before}`);

  // AC-07: disconnect, miss a change, reconnect and catch up.
  await alice.client.removeChannel(aliceCh.channel);
  await cmd(dana, aliceActor, 'damage', { amount: 5 });
  const again = await join_(alice.client, topic);
  check('The player reconnects', again.status === 'SUBSCRIBED', again.status);
  const [aView, dView] = await Promise.all([
    alice.client.rpc('play_snapshot', { p_campaign: camp }),
    dana.client.rpc('play_snapshot', { p_campaign: camp }),
  ]);
  const a = aView.data?.actors?.find((x) => x.actor_id === aliceActor);
  const d = dView.data?.actors?.find((x) => x.actor_id === aliceActor);
  check(
    'AC-07: after reconnecting, both screens show the same state',
    !!a && !!d && a.current_hp === 13 && JSON.stringify(a) === JSON.stringify(d),
    `player hp=${a?.current_hp} v${a?.version} / dm hp=${d?.current_hp} v${d?.version}`,
  );

  for (const c of [dana.client, alice.client, bob.client, pat.client, eve.client, visitor]) await c.removeAllChannels();
} catch (e) {
  console.error(e);
  exitCode = 1;
}

const failedCount = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failedCount}/${results.length} checks passed`);
process.exit(exitCode || (failedCount ? 1 : 0));
