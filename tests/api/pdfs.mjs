#!/usr/bin/env node
// T04b / AC-02 (second half) against the real Storage API of a LOCAL Supabase
// stack (CI): upload, limits, retry, owner-only download. Test files are
// generated here; nothing binary is committed.
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

const BUCKET = 'character-pdfs';
const MiB = 1024 * 1024;
const pdfBytes = (extra = 0) =>
  new Uint8Array(Buffer.concat([Buffer.from('%PDF-1.4\n% test\n'), Buffer.alloc(extra, 0x20), Buffer.from('\n%%EOF\n')]));
const blob = (bytes, type) => new Blob([bytes], { type });

let exitCode = 0;
try {
  const alice = await makeUser('alice');
  const bob = await makeUser('bob');
  const newCharacter = async (client, name) =>
    (await client.rpc('save_character', {
      p_id: null, p_name: name, p_class: null, p_level: null,
      p_armor_class: null, p_max_hp: null, p_notes: null,
    })).data;

  const lyra = await newCharacter(alice, 'Lyra');

  // Concurrent begin calls agree on one path.
  const [b1, b2] = await Promise.all([
    alice.rpc('begin_pdf_upload', { p_character: lyra }),
    alice.rpc('begin_pdf_upload', { p_character: lyra }),
  ]);
  check('Two simultaneous begin calls return the same path', !b1.error && !b2.error && b1.data === b2.data, `${b1.data} / ${b2.data}`);
  const path = b1.data;

  const early = await alice.rpc('finish_pdf_upload', { p_character: lyra });
  check('Finish before upload fails with 409', early.status === 409 && early.error?.message === 'pdf_not_uploaded', describeError(early));

  // Wrong type and oversize are rejected by the bucket.
  const png = await alice.storage.from(BUCKET).upload(path, blob(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png'), { contentType: 'image/png', upsert: true });
  check('A PNG is rejected by the bucket', !!png.error, png.error?.message ?? 'accepted');
  const big = await alice.storage.from(BUCKET).upload(path, blob(pdfBytes(10 * MiB), 'application/pdf'), { contentType: 'application/pdf', upsert: true });
  check('A file over 10 MiB is rejected by the bucket', !!big.error, big.error?.message ?? 'accepted');

  // Retry with a valid PDF on the same path.
  const content = pdfBytes(1000);
  const ok = await alice.storage.from(BUCKET).upload(path, blob(content, 'application/pdf'), { contentType: 'application/pdf', upsert: true });
  check('After failed attempts, a valid PDF uploads', !ok.error, ok.error?.message ?? '');
  const done = await alice.rpc('finish_pdf_upload', { p_character: lyra });
  check('Finish marks it ready with the right size', !done.error && done.data === content.length, `${done.data} vs ${content.length}`);

  const again = await alice.rpc('begin_pdf_upload', { p_character: lyra });
  check('A second PDF for the same character is rejected (409)', again.status === 409 && again.error?.message === 'pdf_exists', describeError(again));
  const overwrite = await alice.storage.from(BUCKET).upload(path, blob(pdfBytes(5), 'application/pdf'), { contentType: 'application/pdf', upsert: true });
  check('A ready PDF cannot be overwritten', !!overwrite.error, overwrite.error?.message ?? 'overwritten');

  const mine = await alice.storage.from(BUCKET).download(path);
  const got = mine.data ? new Uint8Array(await mine.data.arrayBuffer()) : null;
  check('The owner downloads exactly what was uploaded', !!got && Buffer.compare(Buffer.from(got), Buffer.from(content)) === 0, mine.error?.message ?? `${got?.length} bytes`);

  const theirs = await bob.storage.from(BUCKET).download(path);
  check('Another user cannot download it', !!theirs.error && !theirs.data, theirs.error?.message ?? 'downloaded');
  const signed = await bob.storage.from(BUCKET).createSignedUrl(path, 60);
  check('Another user cannot create a link to it', !!signed.error, signed.error?.message ?? 'link created');
  const visitor = createClient(url, publicKey, opts);
  const anon = await visitor.storage.from(BUCKET).download(path);
  check('A visitor cannot download it', !!anon.error, anon.error?.message ?? 'downloaded');
  const listing = await bob.storage.from(BUCKET).list(path.split('/')[0]);
  check("Another user cannot list the owner's folder", !listing.error && (listing.data ?? []).length === 0, `${listing.data?.length ?? 0} items`);

  // Bob cannot write into Alice's folder, even with a valid PDF.
  const intrude = await bob.storage.from(BUCKET).upload(path.replace('.pdf', '-x.pdf'), blob(pdfBytes(1), 'application/pdf'), { contentType: 'application/pdf' });
  check("Another user cannot upload into the owner's folder", !!intrude.error, intrude.error?.message ?? 'uploaded');

  // Known pilot limit (A20): declared type is trusted; bytes are not inspected.
  const fake = await newCharacter(alice, 'Spoof');
  const fakePath = (await alice.rpc('begin_pdf_upload', { p_character: fake })).data;
  const spoof = await alice.storage.from(BUCKET).upload(fakePath, blob(new TextEncoder().encode('not a pdf'), 'application/pdf'), { contentType: 'application/pdf' });
  const spoofDone = await alice.rpc('finish_pdf_upload', { p_character: fake });
  console.log(`info   - A text file declared as application/pdf is ${!spoof.error && !spoofDone.error ? 'ACCEPTED' : 'rejected'} (known pilot limit, A20; the app checks the %PDF- header before upload)`);
} catch (e) {
  console.error(e);
  exitCode = 1;
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(exitCode || (failed ? 1 : 0));
