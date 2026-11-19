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
- Not verified locally: the migration and pgTAP tests, because Docker is not installed (allowed by A19). CI runs them. The migration has not been applied to the hosted `dev` project yet; the user has run `supabase login` and `link`; `db push --remote` follows the merge.
- The Realtime authorization spike moved from T01 to T02 because it needs real users and membership rows.

## Next useful task

The v0.3 [product specification](PRODUCT_SPEC.md#המימוש-הראשון), [pilot architecture](ARCHITECTURE.md#first-pilot-architecture), [decision record](DECISIONS.md#first-pilot-decisions) and [task plan](TASKS.md) are in place. The [branch and release workflow](TASKS.md#ענפים-וגרסאות) is documented. `dev` exists and is protected. Next: merge T01 once CI is green, apply the baseline migration to the `dev` project, then T02 (Google sign-in, profiles, Realtime spike). Hosted-limit validation stays at T09–T10.

## Later planned slices

World/NPC/document management and bulk JSON import; legacy migration; combat/initiative/squads/history; maps and TV display; resource and convenience features. Design map/actor relations now but implement map UI later. Voice logs and billing remain deferred.

## Missing inputs / limitations

- No newer legacy browser export was provided.
- No D&D Beyond character PDF samples were provided.
- No exact D&D edition or automatic rules scope was selected.
- The pilot platform (Vercel + Supabase), database migrations, auth, file storage and realtime transport are selected (A15–A20). Patch versions, hosted account setup and operational validation remain open.
- The prior project's actual failure details and the additional later feature were not supplied.

These gaps do not prevent further design work. Resolve them when their implementation slice needs them, and do not fabricate missing facts.
