#!/usr/bin/env node
// T05a over the real REST and Storage APIs of a LOCAL Supabase stack (CI):
// parallel approvals (AC-03), independent copies, the DM cannot reach the
// player's personal data or PDF, and the join part of AC-04.
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
  const dana = await makeUser('dana');
  const alice = await makeUser('alice');
  const bob = await makeUser('bob');
  const mallory = await makeUser('mallory');
  const pat = await makeUser('pat');
  const visitor = createClient(url, publicKey, opts);
  const uid = async (c) => (await c.auth.getUser()).data.user.id;
  const save = (c, args) => c.rpc('save_character', {
    p_id: null, p_name: null, p_class: null, p_level: null, p_armor_class: null, p_max_hp: null, p_notes: null, ...args,
  });
  const newCampaign = async (name) => {
    const id = (await dana.rpc('create_campaign', { p_name: name })).data;
    await dana.rpc('set_campaign_visibility', { p_campaign: id, p_visibility: 'public' });
    return id;
  };
  const decide = (c, request, decision) => c.rpc('decide_join', { p_request: request, p_decision: decision });

  const A = await newCampaign('Campaign A');
  const B = await newCampaign('Campaign B');

  // Alice: character with private notes and a PDF.
  const lyra = (await save(alice, { p_name: 'Lyra', p_class: 'Ranger', p_level: 3, p_armor_class: 15, p_max_hp: 24, p_notes: 'secret' })).data;
  const pdfPath = (await alice.rpc('begin_pdf_upload', { p_character: lyra })).data;
  await alice.storage.from('character-pdfs').upload(pdfPath, new Blob([new TextEncoder().encode('%PDF-1.4 test')], { type: 'application/pdf' }), { contentType: 'application/pdf' });
  const fin = await alice.rpc('finish_pdf_upload', { p_character: lyra });
  check('Setup: Alice has a ready PDF', !fin.error, describeError(fin));

  // Two approvals at once (AC-03).
  const req = (await alice.rpc('request_join', { p_campaign: A, p_character: lyra })).data;
  const [a1, a2] = await Promise.all([decide(dana, req, 'approve'), decide(dana, req, 'approve')]);
  check(
    'Two simultaneous approvals both succeed with the same result',
    !a1.error && !a2.error && JSON.stringify(a1.data) === JSON.stringify(a2.data),
    `${describeError(a1)} / ${describeError(a2)}`,
  );
  const roster = await dana.from('memberships').select('user_id, role').eq('campaign_id', A);
  check('Exactly one player membership exists', roster.data?.filter((m) => m.role === 'player').length === 1, JSON.stringify(roster.data));
  const copiesA = await dana.from('campaign_characters').select('id, source_character_id, user_id').eq('campaign_id', A);
  check('Exactly one campaign copy exists', copiesA.data?.length === 1, JSON.stringify(copiesA.data));

  // The DM cannot reach the player's personal data or PDF (carried over from T04).
  const aliceId = await uid(alice);
  const guessed = `${aliceId}/${copiesA.data[0].source_character_id}.pdf`;
  check('The DM can derive the PDF path from what she sees', guessed === pdfPath);
  const dmDownload = await dana.storage.from('character-pdfs').download(guessed);
  check("The DM cannot download the player's PDF", !!dmDownload.error && !dmDownload.data, dmDownload.error?.message ?? 'downloaded');
  const dmSign = await dana.storage.from('character-pdfs').createSignedUrl(guessed, 60);
  check("The DM cannot create a link to the player's PDF", !!dmSign.error, dmSign.error?.message ?? 'link');
  for (const table of ['characters', 'character_private', 'character_pdfs']) {
    const r = await dana.from(table).select('*');
    check(`The DM sees nothing in ${table}`, !r.error && r.data.length === 0, describeError(r));
  }
  const preview = await dana.rpc('join_request_preview', { p_request: req });
  check(
    'The preview carries only shared fields',
    !preview.error && JSON.stringify(Object.keys(preview.data[0]).sort()) ===
      JSON.stringify(['armor_class', 'class', 'level', 'max_hp', 'max_hp_missing', 'name']),
    JSON.stringify(preview.data),
  );

  // Cancel and approve at once: exactly one wins.
  const mal = (await save(mallory, { p_name: 'Mal', p_max_hp: 10 })).data;
  const mreq = (await mallory.rpc('request_join', { p_campaign: A, p_character: mal })).data;
  const [ap, ca] = await Promise.all([decide(dana, mreq, 'approve'), decide(mallory, mreq, 'cancel')]);
  const winners = [ap, ca].filter((r) => !r.error).length;
  const loser = [ap, ca].find((r) => r.error);
  check(
    'Cancel and approve at once: exactly one wins, the other gets 409',
    winners === 1 && loser?.status === 409 && loser.error.message === 'request_not_pending',
    `${describeError(ap)} / ${describeError(ca)}`,
  );

  // AC-03: the same character in campaign B gets an independent copy.
  const reqB = (await alice.rpc('request_join', { p_campaign: B, p_character: lyra })).data;
  const bApproval = await decide(dana, reqB, 'approve');
  const copiesB = await dana.from('campaign_characters').select('id, max_hp').eq('campaign_id', B);
  check('Campaign B gets its own copy', !bApproval.error && copiesB.data?.length === 1 && copiesB.data[0].id !== copiesA.data[0].id, describeError(bApproval));
  await save(alice, { p_id: lyra, p_name: 'Lyra', p_class: 'Ranger', p_level: 5, p_armor_class: 15, p_max_hp: 40, p_notes: 'secret' });
  const after = await alice.from('campaign_characters').select('max_hp, level');
  check('Editing the source does not change either copy', after.data?.length === 2 && after.data.every((c) => c.max_hp === 24 && c.level === 3), JSON.stringify(after.data));

  // AC-04 (join part): a pending requester, another member and a visitor.
  const patChar = (await save(pat, { p_name: 'Pat', p_max_hp: 8 })).data;
  const patReq = await pat.rpc('request_join', { p_campaign: A, p_character: patChar });
  check('Pat has a pending request', !patReq.error, describeError(patReq));
  const bobChar = (await save(bob, { p_name: 'Bob', p_max_hp: 12 })).data;
  const bobReq = (await bob.rpc('request_join', { p_campaign: A, p_character: bobChar })).data;
  await decide(dana, bobReq, 'approve');

  for (const [who, client] of [['A pending requester', pat], ['Another member', bob]]) {
    const cc = await client.from('campaign_characters').select('id').eq('campaign_id', A);
    const mine = cc.data?.filter((c) => c.id === copiesA.data[0].id) ?? [];
    check(`${who} cannot see Alice's campaign copy`, !cc.error && mine.length === 0, describeError(cc));
    const st = await client.from('actor_state').select('*').eq('campaign_id', A);
    const others = (st.data ?? []).length - (who === 'Another member' ? 1 : 0);
    check(`${who} cannot see Alice's live state`, !st.error && others === 0, `${st.data?.length} rows`);
    const pv = await client.rpc('join_request_preview', { p_request: req });
    check(`${who} cannot preview Alice's request`, pv.status === 404, describeError(pv));
  }
  for (const table of ['campaign_characters', 'actor_state', 'activity_events', 'join_requests']) {
    const r = await visitor.from(table).select('*');
    check(`A visitor cannot read ${table}`, !!r.error, describeError(r));
  }

  // A private campaign looks missing to a requester.
  const C = (await dana.rpc('create_campaign', { p_name: 'Private C' })).data;
  const privateReq = await pat.rpc('request_join', { p_campaign: C, p_character: patChar });
  check('A private campaign answers 404 to a request', privateReq.status === 404 && privateReq.error?.message === 'campaign_not_found', describeError(privateReq));
} catch (e) {
  console.error(e);
  exitCode = 1;
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(exitCode || (failed ? 1 : 0));
