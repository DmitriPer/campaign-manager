# Progress and handoff

Checkpoint: 2026-11-19. Phase: planning and portable documentation. No new application functionality has been implemented.

## Completed work

- Read the initial Hebrew brief and inspected the legacy HTML's seed data and JavaScript implementation.
- Established the general campaign-management scope, multi-device/multi-user goal, campaign-specific character copies, owner+DM live edits, and DM-approved campaign membership.
- Wrote the initial Hebrew `PRODUCT_SPEC.md` before creating application code.
- Connected the local project to the user's personal GitHub repository and fetched its initial commit. Local `main` tracks `origin/main`; the existing README commit was preserved. The author identity was checked locally as personal; identity values and host-specific settings are intentionally not recorded here.
- Created the persistent knowledge base: startup instructions, context, actual/proposed architecture, decision/status register, progress, and supporting-reference index.
- Copied the original Hebrew brief and self-contained HTML reference into the repository for future machines, preserving their bytes.
- Kept the existing specification; added navigation/status context and replaced its local source path with a portable link. Expanded the existing one-line README into a navigation/handoff entry point.

## Actual implementation state

T01 (in review): Angular 22.3.0 workspace with pinned versions, Hebrew RTL dark shell and start page, a single supabase-js client configured from `.env.local`, Supabase CLI files, a baseline-privileges migration, pgTAP guard tests and GitHub Actions CI. No account system, app tables, session UI, maps, import pipeline, PDF handling or deployment exists. The copied HTML is a historical prototype, not the app's frontend.

## Checks at this checkpoint

- Confirmed source attachments were accessible and compared reference-copy SHA-256 hashes with the originals.
- Parsed embedded JSON: schema version 1, data revision 4, nine locations, 21 NPC records (three templates), four players, zero seeded encounters/snapshots, all player current HP values null.
- Checked local documentation links and the preserved references' presence.
- Reviewed the documentation for confirmed/proposed/implemented distinctions and superseded legacy assumptions.
- Scanned included text for credential/key patterns and absolute local paths; no such matches found after the specification path was replaced. This is a targeted check, not a guarantee from a dedicated secret-scanning service.
- Checked whitespace with `git diff --check` and reviewed the file inventory/diff.
- No application tests or browser UI tests were run: there is no new application or test runner. The legacy HTML was inspected as source, not executed as part of this task.

## Git and cross-computer handoff

At the initial documentation checkpoint, the knowledge base existed only in the local working tree. On 2026-11-19 the user explicitly requested committing and publishing these documents to the personal repository. The publication preparation verified the destination, personal author identity, and that local `main` and fetched `origin/main` had not diverged. All ten intended files passed link, reference-checksum, and targeted credential/local-path checks.

Git history and the remote branch are the authority for synchronization status: verify that the intended commit is present on the remote before changing computers. Only committed and pushed changes are available to another clone; a local file or commit alone is insufficient.

Repository: [DmitriPer/campaign-manager](https://github.com/DmitriPer/campaign-manager). Use normal clone/authentication on each computer; a host alias used by one computer is not a portable dependency. GitHub metadata confirmed public visibility during the Linux handoff.

For continuity:

1. Before switching computers, inspect `git status`, the effective author identity, and the destination; commit the intended changes and push when authorized.
2. On another computer, clone the repository using that computer's authorized personal account. For an existing clean checkout, fetch and update without discarding local changes.
3. Open the repository root as the workspace so `AGENTS.md` is available.
4. Read the knowledge-base startup sequence, compare it to the current source tree, and continue from the next unfinished slice.
5. Update relevant documentation with the implementation, validation, and remaining decisions before the next handoff.

Do not copy local Git configuration, SSH keys, tokens, or operating-system paths into documentation. Preserve existing remote history and avoid force-pushing for routine handoff.

## Linux handoff

On 2026-11-19, HTTPS cloning without credentials succeeded at `f421489`, with `main` tracking `origin/main`. The clone advertised only `main`; `dev` was absent. The user reported creating the PR ruleset. Its effective enforcement and authenticated push access remain unverified.

The Linux host has Node.js 24.15.0, npm 11.12.1, Corepack 0.34.6, and Git 2.43.0. These are observed host versions. The project has no manifest or lockfile, so package-manager selection, dependency installation, and application build/start/test checks await scaffolding.

The committed Hebrew specification, original brief, and legacy HTML are available on Linux. The original macOS Codex conversation and browser-local changes were unavailable for independent review.

## Architecture review (2026-11-19)

A documentation review found the pilot design consistent overall and fixed four schema ambiguities in the spec, architecture and decision record (A10–A14): a separate `CampaignCharacter` copy table, base versus effective Max HP, a nullable session on `ActivityEvent`, effect child rows, and Prisma Migrate as the single app-table migration tool (later superseded by A18). These are documentation changes only; no schema exists yet.

Risks raised but not decided in this change:

- The public repository exposes fictional DM-only content in the legacy HTML to anyone, including players of that campaign. Consider deciding before T10 rather than at it.
- ~~Render free compute sleeps when idle.~~ Removed by the stack revision below.
- `CommandReceipt` has no retention policy yet; define one in T06.

## Stack revision (2026-11-19)

The user found the NestJS/Render plan hard to follow and wants the pilot free. After discussing the trade-offs, they chose Angular on Vercel talking directly to Supabase, with permissions and game commands in SQL (A15–A20). The user knows SQL and has used Vercel. Docker is optional locally. Product decisions and acceptance criteria are unchanged. Free-tier limits were checked against the providers' pages on 2026-11-19 and are recorded in the decision record.

Repository setup completed the same day: `dev` was created from `main` and the PR ruleset now covers both branches (verified through the GitHub API).

## T01 checkpoint (2026-11-19)

- The user created a free Supabase project for development. The CLI reports its name as `campaign-manager-dev`; the other recommended settings (Central EU region, automatic API grants off, automatic RLS on) have not been confirmed; the baseline migration does not depend on them. The project URL and publishable key are only in the developer's git-ignored `.env.local`.
- Verified locally on Linux: `npm ci`, `npm run build` and `npm test` (2 unit tests) pass.
- Not verified locally: the migration and pgTAP tests, because Docker is not installed (allowed by A19). CI runs them. The user applied the migration to the hosted `dev` project with `supabase db push --remote` on 2026-11-19. `supabase test db --remote` cannot run there because it also needs Docker; use `supabase/checks/baseline_privileges.sql` in the SQL Editor instead. Its first run on the hosted project found `public.rls_auto_enable()` (the dashboard's automatic-RLS event trigger) executable by `anon`; migration `20261119210000_lock_rls_auto_enable.sql` revokes it and was applied on 2026-11-20 (`db push --remote`). Verified on the hosted project the same day with `supabase db query --remote`: baseline check all as expected (0 tables without RLS, 0 anon-executable functions, `app_private` closed, both migrations recorded); `rls_auto_enable()` is no longer executable by `anon` or `authenticated`; the `ensure_rls` event trigger is still enabled; and a table created inside a rolled-back transaction got RLS automatically.
- The Realtime authorization spike moved from T01 to T02 because it needs real users and membership rows.

## T02a checkpoint (2026-11-20)

T02 was split: T02a (Google sign-in and profiles) and T02b (Realtime authorization spike on a per-user private channel, since memberships arrive in T03).

- Implemented: `profiles` migration with signup trigger and RLS, guard tests, Angular sign-in/out with PKCE, `/auth/callback`, name in header, unit tests with a fake Supabase client. CI's database stack now includes the auth service.
- Verified locally: build and 5 unit tests pass. In the browser against the hosted dev project, the page renders RTL on desktop and phone width, and the Google button sends a PKCE request to Supabase with `/auth/callback` as the return URL; Supabase answers `provider is not enabled`, as expected before Google is configured.
- Merged to `dev` (PR #9) with CI green: build, 5 unit tests, migrations, 24 pgTAP tests.
- Applied `20261120090000_profiles.sql` to the hosted dev project on 2026-11-20 and verified with read-only `db query --remote`: baseline check unchanged (0 tables without RLS, 0 anon-executable functions), `profiles` has RLS and one policy, `authenticated` may select but not write, `anon` has no access, the trigger exists, and only `supabase_auth_admin` may execute the hook. A user inserted inside a rolled-back transaction got the profile "Probe User"; nothing was left behind.
- Not yet done: Google provider setup ([guide](SETUP_GOOGLE_SIGNIN.md)) and a real sign-in.

## T02b checkpoint (2026-11-20)

- Implemented the per-user private Realtime channel and `realtime_self_test()`, with 9 pgTAP checks and a live two-user CI job.
- CI green on PR #11: build and unit tests, 33 pgTAP tests, and 10/10 live checks. Bob and a signed-out visitor got `CHANNEL_ERROR: Unauthorized` on Alice's channel; Alice received the database signal in 132 ms; nobody else received anything.
- The database CI job now also starts Realtime, because `realtime.send` stores messages in partitions that the Realtime service creates.
- Merged (PR #11) and applied to the hosted dev project on 2026-11-20. Verified with `db query --remote`: the baseline check is unchanged, the only policy on `realtime.messages` is `user_channel_receive_own`, the self-test is executable by `authenticated` and not by `anon`, and all four migrations are recorded.
- **Finding:** on the hosted project, `realtime.messages` had **no partitions** until a client first connected to Realtime, so `realtime.send` stored nothing and only raised a warning. One connection made the Realtime service create 5 partitions; after that, a rolled-back test showed the owner sees the signal and another user does not. Implication for T07: a signal sent while Realtime is idle (for example after a free-tier pause) can be lost silently. The planned 15-second reconciliation read and the snapshot read on reconnect cover this; do not rely on every signal arriving.

## T03 checkpoint (2026-11-20)

- Implemented campaigns, memberships, `create_campaign`, `set_campaign_visibility` and `public_campaign_profile`; Angular "my campaigns", create form with Hebrew validation, and `/c/:campaignId` for members and visitors.
- Tests: 25 pgTAP checks for T03/AC-01, two new guard tests, a live REST test (`tests/api/campaigns.mjs`) in the renamed non-required CI job "Live API and Realtime checks", and 12 unit tests.
- Verified locally: build and 12 unit tests. In the browser as a visitor, an invalid id shows "not found"; a valid id currently shows a generic error because the hosted project does not have the function yet (`PGRST202`), as expected before `db push`.
- The hosted baseline check now excludes the allowlisted `public_campaign_profile(p_campaign uuid)`.
- CI green on PR #13 after one fix found by the live REST test: `campaign_not_found` returned HTTP 500 (PostgREST maps `P0002` to 500); it now uses PostgREST's custom-error form and returns 404.
- Merged (PR #13) and applied to the hosted dev project on 2026-11-20. Verified: baseline check unchanged (allowlist respected), RLS on both tables, two policies, anon has no table access and cannot create, the helper functions are not callable by anon, five migrations recorded. Over REST as a visitor: `public_campaign_profile` → `[]` HTTP 200, `create_campaign` → 401, `campaigns` table → 401. A rolled-back flow (create → DM membership → private invisible → publish → visitor sees only name/description → other user still cannot read the table) passed; nothing was left behind.
- Not yet: signed-in UI testing (needs the Google setup).

## T04a checkpoint (2026-11-20)

T04 was split: T04a (character library and private notes) and T04b (private PDF storage), because storage adds a CI service, a bucket and an upload flow.

- Implemented `characters`, `character_private`, `save_character`, and the `/characters` list and editor (Hebrew validation, empty fields saved as unknown).
- Tests: 20 pgTAP checks (79 total), live REST test `tests/api/characters.mjs` (11 checks), 19 unit tests. CI green on the database commit.
- Verified locally: build and 19 unit tests; as a visitor, `/characters` and `/characters/new` show the sign-in prompt.
- The "DM cannot download the PDF" check moves to T05, when a DM relationship to a character first exists.
- Not yet: hosted migration, and signed-in UI testing (needs the Google setup).

## Next useful task

The v0.3 [product specification](PRODUCT_SPEC.md#המימוש-הראשון), [pilot architecture](ARCHITECTURE.md#first-pilot-architecture), [decision record](DECISIONS.md#first-pilot-decisions) and [task plan](TASKS.md) are in place. The [branch and release workflow](TASKS.md#ענפים-וגרסאות) is documented. `dev` exists and is protected. Next: apply the T02b migration to the hosted project, finish T02a's Google setup and real sign-in, then T04b (private PDF) and T05 (join requests). Hosted-limit validation stays at T09–T10.

## Later planned slices

World/NPC/document management and bulk JSON import; legacy migration; combat/initiative/squads/history; maps and TV display; resource and convenience features. Design map/actor relations now but implement map UI later. Voice logs and billing remain deferred.

## Missing inputs / limitations

- No newer legacy browser export was provided.
- No D&D Beyond character PDF samples were provided.
- No exact D&D edition or automatic rules scope was selected.
- The pilot platform (Vercel + Supabase), database migrations, auth, file storage and realtime transport are selected (A15–A20). Patch versions, hosted account setup and operational validation remain open.
- The prior project's actual failure details and the additional later feature were not supplied.

These gaps do not prevent further design work. Resolve them when their implementation slice needs them, and do not fabricate missing facts.
