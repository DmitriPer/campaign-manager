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

No Angular scaffolding, backend, database, account system, runtime session UI, maps, import pipeline, PDF extraction, test infrastructure, or deployment exists. The copied HTML is a historical standalone prototype, not the new application's frontend. No application behavior was changed during the knowledge-base task.

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

Repository: [DmitriPer/campaign-manager](https://github.com/DmitriPer/campaign-manager). Use normal clone/authentication on each computer; a host alias used by one computer is not a portable dependency. Repository visibility has not been independently verified.

For continuity:

1. Before switching computers, inspect `git status`, the effective author identity, and the destination; commit the intended changes and push when authorized.
2. On another computer, clone the repository using that computer's authorized personal account. For an existing clean checkout, fetch and update without discarding local changes.
3. Open the repository root as the workspace so `AGENTS.md` is available.
4. Read the knowledge-base startup sequence, compare it to the current source tree, and continue from the next unfinished slice.
5. Update relevant documentation with the implementation, validation, and remaining decisions before the next handoff.

Do not copy local Git configuration, SSH keys, tokens, or operating-system paths into documentation. Preserve existing remote history and avoid force-pushing for routine handoff.

## Next useful task

Complete concrete permission/use-case scenarios before scaffolding. Start with the path that the first live slice needs:

1. Owner uploads a character PDF and enters fields manually.
2. Player requests to join a campaign; DM approves; an independent campaign copy is established.
3. DM starts a session with a campaign character present.
4. Owner and DM change live HP/effects; both clients observe the same persisted state and attributed log.
5. Retry/concurrent edits and reconnect do not lose or duplicate changes.
6. Session ends; the same live values are retained; historical viewing cannot modify them.

Resolve relevant questions in `DECISIONS.md` (especially Q01, Q03–Q06) and select the infrastructure needed for that slice. Then scaffold Angular and the selected backend/database in a separate implementation task. Do not create all proposed features at once.

## Later planned slices

World/NPC/document management and bulk JSON import; legacy migration; combat/initiative/squads/history; maps and TV display; resource and convenience features. Design map/actor relations now but implement map UI later. Voice logs and billing remain deferred.

## Missing inputs / limitations

- No newer legacy browser export was provided.
- No D&D Beyond character PDF samples were provided.
- No exact D&D edition or automatic rules scope was selected.
- Backend/store/DB direction is proposed; package versions, auth/hosting, ORM, real-time transport, and file storage have not been finalized.
- The prior project's actual failure details and the additional later feature were not supplied.

These gaps do not prevent further design work. Resolve them when their implementation slice needs them, and do not fabricate missing facts.
