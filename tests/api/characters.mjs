#!/usr/bin/env node
// T04a / AC-02 (first half) over the real REST API of a LOCAL Supabase stack (CI):
// unknown values stay null, private notes and characters are owner-only.
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
  const save = (client, args) =>
    client.rpc('save_character', {
      p_id: null, p_name: null, p_class: null, p_level: null,
      p_armor_class: null, p_max_hp: null, p_notes: null, ...args,
    });

  const draft = await save(alice, { p_name: 'Lyra' });
  check('Alice saves a name-only draft', !draft.error && typeof draft.data === 'string', describeError(draft));
  const id = draft.data;

  const read = await alice.from('characters').select('name, class, level, armor_class, max_hp').eq('id', id).single();
  check(
    'Missing values come back as null, not 0',
    !read.error && read.data.class === null && read.data.level === null &&
      read.data.armor_class === null && read.data.max_hp === null,
    JSON.stringify(read.data),
  );

  const full = await save(alice, {
    p_id: id, p_name: 'Lyra', p_class: 'Ranger', p_level: 3, p_armor_class: 15, p_max_hp: 24, p_notes: 'secret',
  });
  check('Alice fills in details', !full.error && full.data === id, describeError(full));

  const notes = await alice.from('character_private').select('notes').eq('character_id', id).single();
  check('Alice reads her private notes', !notes.error && notes.data.notes === 'secret', describeError(notes));

  const bad = await save(alice, { p_name: 'X', p_level: 25 });
  check('An invalid level is rejected with 400', bad.status === 400 && bad.error?.message === 'invalid_level', describeError(bad));

  const bobRead = await bob.from('characters').select('*').eq('id', id);
  check("Bob cannot read Alice's character", !bobRead.error && bobRead.data.length === 0, describeError(bobRead));
  const bobNotes = await bob.from('character_private').select('*').eq('character_id', id);
  check("Bob cannot read Alice's private notes", !bobNotes.error && bobNotes.data.length === 0, describeError(bobNotes));
  const bobWrite = await save(bob, { p_id: id, p_name: 'Stolen' });
  check(
    "Bob cannot overwrite Alice's character and gets 404",
    bobWrite.status === 404 && bobWrite.error?.message === 'character_not_found',
    describeError(bobWrite),
  );

  const visitorRead = await visitor.from('characters').select('*');
  check('A visitor cannot read characters', !!visitorRead.error, describeError(visitorRead));
  const visitorSave = await save(visitor, { p_name: 'X' });
  check('A visitor cannot create characters', !!visitorSave.error, describeError(visitorSave));

  const direct = await alice.from('characters').update({ name: 'hacked' }).eq('id', id).select();
  check('Even the owner cannot update the table directly', !!direct.error || (direct.data ?? []).length === 0, describeError(direct));
} catch (e) {
  console.error(e);
  exitCode = 1;
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(exitCode || (failed ? 1 : 0));
