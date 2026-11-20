#!/usr/bin/env node
// T03 / AC-01 over the real REST API (PostgREST) of a LOCAL Supabase stack (CI):
// what a browser can actually reach, with real JWTs. Complements pgTAP.
//
// Required env (from `supabase status -o env`): API_URL, ANON_KEY or
// PUBLISHABLE_KEY, SERVICE_ROLE_KEY or SECRET_KEY. Refuses non-local URLs.
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
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, adminKey, opts);
const stamp = Date.now();

async function makeUser(name) {
  const email = `${name}.${stamp}@example.test`;
  const password = `pw-${stamp}-${name}`;
  const { error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: name },
  });
  if (error) throw new Error(`createUser ${name}: ${error.message}`);
  const client = createClient(url, publicKey, opts);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn ${name}: ${signInError.message}`);
  return client;
}

const describeError = (r) => `HTTP ${r.status}${r.error ? ` ${r.error.code} ${r.error.message}` : ''}`;

let exitCode = 0;
try {
  const alice = await makeUser('alice');
  const bob = await makeUser('bob');
  const visitor = createClient(url, publicKey, opts);

  const created = await alice.rpc('create_campaign', { p_name: 'Shadows of the North', p_description: 'A test campaign' });
  check('Alice creates a campaign', !created.error && typeof created.data === 'string', describeError(created));
  const id = created.data;

  const visitorCreate = await visitor.rpc('create_campaign', { p_name: 'X' });
  check('A visitor cannot create a campaign', !!visitorCreate.error, describeError(visitorCreate));

  // Private campaign.
  const visitorTable = await visitor.from('campaigns').select('*');
  check(
    'A visitor cannot read the campaigns table',
    !!visitorTable.error || (visitorTable.data ?? []).length === 0,
    describeError(visitorTable),
  );
  const bobRead = await bob.from('campaigns').select('*').eq('id', id);
  check("Bob cannot read Alice's private campaign by id", !bobRead.error && bobRead.data.length === 0, describeError(bobRead));
  const bobMembers = await bob.from('memberships').select('*').eq('campaign_id', id);
  check("Bob cannot read Alice's memberships", !bobMembers.error && bobMembers.data.length === 0, describeError(bobMembers));

  const privateProfile = await visitor.rpc('public_campaign_profile', { p_campaign: id });
  check('A private campaign has no public profile', !privateProfile.error && privateProfile.data.length === 0, describeError(privateProfile));
  const missingProfile = await visitor.rpc('public_campaign_profile', { p_campaign: '99999999-9999-4999-8999-999999999999' });
  check(
    'A missing campaign answers exactly like a private one',
    missingProfile.status === privateProfile.status && JSON.stringify(missingProfile.data) === JSON.stringify(privateProfile.data),
    `${missingProfile.status} vs ${privateProfile.status}`,
  );

  const bobPublish = await bob.rpc('set_campaign_visibility', { p_campaign: id, p_visibility: 'public' });
  check(
    "Bob cannot publish Alice's campaign and gets 404 not found",
    bobPublish.status === 404 && bobPublish.error?.message === 'campaign_not_found',
    describeError(bobPublish),
  );

  // Alice publishes.
  const publish = await alice.rpc('set_campaign_visibility', { p_campaign: id, p_visibility: 'public' });
  check('Alice can publish', !publish.error && publish.data === 'public', describeError(publish));

  const publicProfile = await visitor.rpc('public_campaign_profile', { p_campaign: id });
  const row = publicProfile.data?.[0] ?? {};
  check(
    'A visitor sees exactly name and description',
    !publicProfile.error &&
      publicProfile.data.length === 1 &&
      JSON.stringify(Object.keys(row).sort()) === JSON.stringify(['description', 'name']) &&
      row.name === 'Shadows of the North',
    JSON.stringify(publicProfile.data),
  );
  const bobAfter = await bob.from('campaigns').select('*').eq('id', id);
  check('Publishing does not open the campaigns table to Bob', !bobAfter.error && bobAfter.data.length === 0, describeError(bobAfter));

  const aliceRead = await alice.from('campaigns').select('id, name, visibility').eq('id', id);
  check('Alice reads her campaign', !aliceRead.error && aliceRead.data.length === 1, describeError(aliceRead));

  const direct = await alice.from('campaigns').update({ name: 'hacked' }).eq('id', id).select();
  check('Even the DM cannot update the table directly', !!direct.error || (direct.data ?? []).length === 0, describeError(direct));

  // Back to private.
  await alice.rpc('set_campaign_visibility', { p_campaign: id, p_visibility: 'private' });
  const afterPrivate = await visitor.rpc('public_campaign_profile', { p_campaign: id });
  check('After making it private, visitors see nothing', !afterPrivate.error && afterPrivate.data.length === 0, describeError(afterPrivate));
} catch (e) {
  console.error(e);
  exitCode = 1;
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(exitCode || (failed ? 1 : 0));
