#!/usr/bin/env node
// T02b live check against a LOCAL Supabase stack (CI): two real users, the real
// Realtime server, private broadcast channels authorized by RLS.
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
function join(client, topic) {
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
  const alice = await makeUser('alice');
  const bob = await makeUser('bob');

  const aliceOwn = await join(alice.client, `user:${alice.id}`);
  check('Alice can join her own private channel', aliceOwn.status === 'SUBSCRIBED', aliceOwn.status);

  const bobOwn = await join(bob.client, `user:${bob.id}`);
  check('Bob can join his own private channel', bobOwn.status === 'SUBSCRIBED', bobOwn.status);

  const bobSpy = await join(bob.client, `user:${alice.id}`);
  check(
    "Bob is refused on Alice's private channel",
    bobSpy.status !== 'SUBSCRIBED',
    `${bobSpy.status}${bobSpy.error ? `: ${bobSpy.error}` : ''}`,
  );

  const anon = createClient(url, publicKey, opts);
  const anonSpy = await join(anon, `user:${alice.id}`);
  check(
    "A signed-out visitor is refused on Alice's private channel",
    anonSpy.status !== 'SUBSCRIBED',
    anonSpy.status,
  );

  const sentAt = Date.now();
  const { error: rpcError } = await alice.client.rpc('realtime_self_test');
  check('Alice can trigger a database-originated signal', !rpcError, rpcError?.message ?? '');

  for (let i = 0; i < 50 && aliceOwn.received.length === 0; i++) await sleep(100);
  const latency = aliceOwn.received.length ? `${Date.now() - sentAt} ms` : 'not received';
  check('Alice receives the signal on her channel', aliceOwn.received.length === 1, latency);
  const payload = aliceOwn.received[0]?.payload ?? {};
  check(
    'The signal carries no game data',
    payload.kind === 'changed' && Object.keys(payload).every((k) => ['kind', 'probe', 'id'].includes(k)),
    JSON.stringify(payload),
  );

  await sleep(1500);
  check('Bob receives nothing on his own channel', bobOwn.received.length === 0);
  check("Bob receives nothing from Alice's channel", bobSpy.received.length === 0);
  check('The visitor receives nothing', anonSpy.received.length === 0);

  for (const c of [alice.client, bob.client, anon]) await c.removeAllChannels();
} catch (e) {
  console.error(e);
  exitCode = 1;
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(exitCode || (failed ? 1 : 0));
