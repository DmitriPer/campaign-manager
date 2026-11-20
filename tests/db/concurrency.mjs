#!/usr/bin/env node
// T06a deterministic races (AC-05, AC-06, AC-08) against a LOCAL Supabase
// database (CI). Two direct connections act as two users: connection A opens a
// transaction and runs a command (holding its locks); connection B runs a
// conflicting command, which must BLOCK; then A commits and we check the outcome.
//
// Required env: DB_URL (from `supabase status -o env`). Refuses non-local URLs.
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const dbUrl = process.env.DB_URL;
if (!dbUrl || !/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(dbUrl)) {
  console.error(`DB_URL missing or not local: ${dbUrl ?? '(unset)'}`);
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'ok    ' : 'not ok'} - ${name}${detail ? ` (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const c = new pg.Client({ connectionString: dbUrl });
  await c.connect();
  await c.query("set lock_timeout = '5s'; set statement_timeout = '10s'");
  return c;
}

/** Runs `sql` as `user` inside the CURRENT transaction of `client`. */
async function as(client, user, sql, params = []) {
  await client.query("select set_config('role', 'authenticated', true), set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: user, role: 'authenticated' }),
  ]);
  return client.query(sql, params);
}

/** One-shot call in its own transaction. Returns { rows } or { error }. */
async function call(client, user, sql, params = []) {
  await client.query('begin');
  try {
    const r = await as(client, user, sql, params);
    await client.query('commit');
    return { rows: r.rows };
  } catch (e) {
    await client.query('rollback');
    return { error: e };
  }
}

const errCode = (e) => {
  try {
    return JSON.parse(e.message).code;
  } catch {
    return e?.message;
  }
};

/** Starts B's call and verifies it is still waiting (blocked on A's lock). */
async function startBlocked(promise) {
  let settled = false;
  promise.finally(() => (settled = true));
  await sleep(400);
  return !settled;
}

const CMD = 'select public.actor_command($1, $2, $3, $4, $5, $6) as r';

let exitCode = 0;
const setup = await connect();
const a = await connect();
const b = await connect();
try {
  // Users and a campaign with Alice approved (Max HP 18).
  const dana = randomUUID();
  const alice = randomUUID();
  await setup.query(
    `insert into auth.users (id, email, raw_user_meta_data) values
       ($1, $1 || '@example.test', '{"full_name":"Dana"}'), ($2, $2 || '@example.test', '{"full_name":"Alice"}')`,
    [dana, alice],
  );
  const camp = (await call(setup, dana, "select public.create_campaign('Race') as id")).rows[0].id;
  await call(setup, dana, "select public.set_campaign_visibility($1, 'public')", [camp]);
  const ch = (await call(setup, alice, "select public.save_character(null, 'Lyra', null, null, null, 18, null) as id")).rows[0].id;
  const req = (await call(setup, alice, 'select public.request_join($1, $2) as id', [camp, ch])).rows[0].id;
  const actor = (await call(setup, dana, "select actor_id from public.decide_join($1, 'approve')", [req])).rows[0].actor_id;
  const hp = async () =>
    (await setup.query('select current_hp, version from public.actor_state where actor_id = $1', [actor])).rows[0];
  const events = async (kind) =>
    Number((await setup.query('select count(*) from public.activity_events where actor_id = $1 and kind = $2', [actor, kind])).rows[0].count);

  // ---- AC-05: two session starts at once -> one active, unique number.
  await a.query('begin');
  await as(a, dana, 'select * from public.start_session($1)', [camp]);
  const bStart = call(b, dana, 'select * from public.start_session($1)', [camp]);
  check('AC-05: a second start waits for the first', await startBlocked(bStart));
  await a.query('commit');
  const second = await bStart;
  check('AC-05: the second start is refused (409 session_active)', errCode(second.error) === 'session_active', errCode(second.error));
  const sessions = (await setup.query('select id, number, status from public.sessions where campaign_id = $1 order by number', [camp])).rows;
  check('AC-05: exactly one session, number 1', sessions.length === 1 && sessions[0].number === 1, JSON.stringify(sessions));
  const s1 = sessions[0].id;

  // HP 18 to start.
  await call(setup, alice, CMD, [camp, s1, actor, randomUUID(), 'set_hp', { value: 18, expected_version: 1 }]);

  // ---- AC-06: two users deal 3 and 4 at once; one resends after a lost response.
  const op3 = randomUUID();
  const op4 = randomUUID();
  await a.query('begin');
  await as(a, dana, CMD, [camp, s1, actor, op3, 'damage', { amount: 3 }]);
  const bDamage = call(b, alice, CMD, [camp, s1, actor, op4, 'damage', { amount: 4 }]);
  check('AC-06: the second damage waits for the first', await startBlocked(bDamage));
  await a.query('commit');
  const d4 = await bDamage;
  check('AC-06: both damages succeed', !d4.error, errCode(d4.error));
  check('AC-06: HP is 18 - 3 - 4 = 11', (await hp()).current_hp === 11, JSON.stringify(await hp()));
  check('AC-06: two damage events', (await events('damage')) === 2);

  const replay = await call(setup, dana, CMD, [camp, s1, actor, op3, 'damage', { amount: 3 }]);
  check('AC-06: resending after a lost response replays', replay.rows?.[0].r.replayed === true, JSON.stringify(replay.rows?.[0].r));
  check('AC-06: the replay changes nothing', (await hp()).current_hp === 11 && (await events('damage')) === 2);

  // A duplicate sent at the same moment waits and then gets the stored result.
  const opDup = randomUUID();
  await a.query('begin');
  await as(a, alice, CMD, [camp, s1, actor, opDup, 'heal', { amount: 1 }]);
  const bDup = call(b, alice, CMD, [camp, s1, actor, opDup, 'heal', { amount: 1 }]);
  check('AC-06: a simultaneous duplicate waits', await startBlocked(bDup));
  await a.query('commit');
  const dup = await bDup;
  check(
    'AC-06: the simultaneous duplicate returns the stored result and heals once',
    dup.rows?.[0].r.replayed === true && (await hp()).current_hp === 12,
    `${JSON.stringify(dup.rows?.[0].r)} hp=${(await hp()).current_hp}`,
  );

  const stale = await call(setup, alice, CMD, [camp, s1, actor, randomUUID(), 'set_hp', { value: 18, expected_version: 2 }]);
  check('AC-06: an absolute set from an old version is refused', errCode(stale.error) === 'version_conflict', errCode(stale.error));

  // ---- AC-08 order 1: the command commits first, then the end.
  const before1 = (await hp()).current_hp;
  await a.query('begin');
  await as(a, alice, CMD, [camp, s1, actor, randomUUID(), 'damage', { amount: 2 }]);
  const bEnd = call(b, dana, 'select * from public.end_session($1, $2)', [camp, s1]);
  check('AC-08: ending waits for a command in progress', await startBlocked(bEnd));
  await a.query('commit');
  const ended = await bEnd;
  check('AC-08: the end succeeds', !ended.error, errCode(ended.error));
  const order = (await setup.query(
    `select kind from public.activity_events where session_id = $1 and kind in ('damage','session_ended') order by id desc limit 2`, [s1],
  )).rows.map((r) => r.kind);
  check('AC-08: the damage that finished first is kept, logged before the end', order.join(',') === 'session_ended,damage' && (await hp()).current_hp === before1 - 2, order.join(','));

  // ---- AC-08 order 2: the end holds its locks; a command waits, then is refused.
  const s2 = (await call(setup, dana, 'select id from public.start_session($1)', [camp])).rows[0].id;
  const before2 = await hp();
  await a.query('begin');
  await as(a, dana, 'select * from public.end_session($1, $2)', [camp, s2]);
  const bLate = call(b, alice, CMD, [camp, s2, actor, randomUUID(), 'damage', { amount: 5 }]);
  check('AC-08: a command waits while the session is ending', await startBlocked(bLate));
  await a.query('commit');
  const late = await bLate;
  check('AC-08: the late command is refused (409 session_not_active)', errCode(late.error) === 'session_not_active', errCode(late.error));
  check('AC-08: the late command changed nothing', (await hp()).current_hp === before2.current_hp);

  // State persists into a new session; reading history changes nothing.
  const s3 = (await call(setup, dana, 'select id, number from public.start_session($1)', [camp])).rows[0];
  check('AC-08: a new session starts with the last state', (await hp()).current_hp === before2.current_hp && s3.number === 3, `hp=${(await hp()).current_hp} n=${s3.number}`);
  const v0 = (await hp()).version;
  await call(setup, dana, 'select * from public.session_activity($1)', [s1]);
  await call(setup, dana, 'select public.play_snapshot($1)', [camp]);
  check('AC-08: reading history and the snapshot does not change state', (await hp()).version === v0);

  // ---- AC-05: an update from an old session's screen is refused while a new one is active.
  const old = await call(setup, alice, CMD, [camp, s1, actor, randomUUID(), 'heal', { amount: 1 }]);
  check('AC-05: a command for an old session is refused', errCode(old.error) === 'session_not_active', errCode(old.error));
} catch (e) {
  console.error(e);
  exitCode = 1;
} finally {
  await Promise.allSettled([setup.end(), a.end(), b.end()]);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(exitCode || (failed ? 1 : 0));
