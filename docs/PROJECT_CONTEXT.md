# Project context

Last reviewed: 2026-11-19. Status: product planning; application implementation has not started.

## Purpose and origin

Build a browser application for preparing and running tabletop campaigns with shared live character state and a DM-controlled player display. The owner previously had a similar project fail because of a major planning problem; the actual prior failure is not described, so do not invent its cause. The explicit preference is to settle the product model and implement in stages.

Working name: **Campaign Manager**. The user rejected **Adisdas** as the product name. Adisdas is an example campaign and a source for migration/testing. The final public-facing name is undecided.

The application should be free initially, starting with personal use but designed for user registration and multiple campaigns. A modest future charge for servers/support is a possibility, not a current billing requirement. Hosting still has costs. The user needs access from multiple devices; a single-browser localStorage-only application does not meet the target.

Angular was explicitly chosen over React. The user's underlying reason was deferred and has not been provided. The intended UI is Hebrew RTL, dark, and quick to operate during play. Preserve existing narrative content and the useful dark-fantasy visual reference without making the entire product specific to one campaign.

## Users and ownership

- One account can be a DM in one campaign and a player in another. Roles are scoped to membership, not a global account type.
- Users manage personal characters and can request membership in other users' campaigns. DMs can discover public characters and invite their owners.
- A character gets an independent campaign-specific version when assigned to a campaign. Progress, items, injuries, and live state are isolated between campaigns. Automatic ongoing synchronization from the personal original is not part of the agreed behavior.
- Campaign visibility can be private, restricted to selected people, or public. Visibility and membership are separate. Joining a public campaign requires DM approval; no free-entry mode was selected.
- Character visibility can be owner-only, shared with selected campaigns, or public for discovery. Exact field-level visibility and the lifecycle after leaving a campaign remain open.
- Both the character owner and DM may update its live state during a session. The DM sees player changes in real time and each change records its author.

## Character onboarding

Users upload a D&D Beyond PDF and fill in details manually. Building a complete character creation/rules wizard is not required. Automated PDF extraction with review is an optional design proposal; supported formats and extraction accuracy are unverified because no sample character PDFs were supplied.

Outside a session, users can maintain general data such as level, equipment, clothing, spells, and stats. During a session they change live HP, effects, and resource usage. Ending a session preserves the exact live state. Level-up, rest, or session start must not silently heal/reset the character. The policy for a changed maximum that conflicts with current values must be decided explicitly.

## Main workflows

### Campaign preparation

The DM manages notes/documents, NPCs and templates, places, and maps. Places are nested flexibly: world, region, city/town/site, building/cave/dungeon, room/floor. A place may have multiple maps. A fictional location's legacy `locked` field is world metadata, not access control.

Keep confirmed facts distinct from drafts and unapproved ideas. Existing narrative fields include appearance, voice, motives, knowledge, revelations, DM-only secrets, quotes, notes, and source attribution.

### Live session

The DM starts a numbered session for tracking. The intended distinction is preparation outside the session and live operation during it; content-authoring is locked during active play, while runtime changes and session notes remain available. Pause behavior and exception policies still need detail.

The DM workspace includes map, reference notes, NPC/monster information, player sheets, and combat tabs. Switching tabs must not change or stop the broadcast map. The player view is usable on phones; the DM may use a desktop while a second computer drives a large TV.

Session, combat, and player presentation are separate concepts. A session can contain multiple encounters and map scenes. An encounter can include any selected subset of players, NPCs, monsters, and enemies. Map selection can help assemble combat but the combat model must also work before map UI exists.

### Shared live state and combat

Changing live HP, effects, and alive/dead state in combat updates the same actor elsewhere in the campaign. Named NPCs persist as world identities; a template can spawn multiple independent soldiers. Initiative is initially manual. Squads retain shared initiative/turn handling with independent members.

The original app's automatically added four players are sample data/legacy behavior, not a fixed roster or a target combat requirement. Its manual conditions/death tracking are bookkeeping references, not a complete implementation of D&D rules.

### Player display

A dedicated URL shows the map and information chosen by the DM. Tokens can be shown/hidden and moved. Player movement permission and DM movement lock are proposed controls. Presentation state persists independently of the DM's current tab and survives refresh/reconnection. Display access must be limited and revocable; exact pairing/authentication flow is not selected.

Hidden actors, unrevealed map content, and DM notes must not be sent to unauthorized clients. Public campaign discovery does not make the DM's campaign content public.

## Reliability and usability requirements endorsed in planning

- Attributed activity log and a way to correct mistakes without erasing subsequent changes.
- Explicit connection/save state; recover current state after reconnect; handle concurrent updates and retries.
- A proposal to block game mutations while disconnected in the first release; offline conflict merging is deferred.
- Persistent effects/resources, optional effect metadata and reminders, explicit rest actions, no automatic end-of-session reset.
- Pause/resume, session summaries, and separate history/live views; detailed pause semantics remain proposed.
- Later convenience features: map ping, sharing handouts/images, fast DM search, private/shared notes, and a player mobile view.

The user broadly accepted these additions. This does not constitute approval of every subsequent state name, table shape, or technical mechanism; see the status labels in [DECISIONS.md](DECISIONS.md).

## Imports, export, and reference preservation

Bulk JSON import is an early requirement: load multiple NPCs/characters, validate, preview additions/updates/errors, resolve location references, and avoid duplicates on re-import. The first detailed format proposed is for NPCs. Full-backup restore and incremental entity import are distinct workflows. Stable source identities and versioned schemas are proposed; the schema is not implemented or finalized.

The accessible legacy HTML and original Hebrew brief are preserved in [references](references/README.md). The HTML has nine locations, 21 NPC records (three templates), four players with unknown current HP, and no seeded encounters/snapshots. A more recent browser-local state may exist elsewhere but was not supplied. Do not represent the embedded seed as a verified latest campaign backup.

## Scope and sequencing

1. Finish core workflows, permissions, state transitions, and unresolved decisions affecting the first implementation.
2. Accounts, campaigns, memberships/invitations, personal characters, and campaign copies.
3. A small end-to-end live session between DM and player browsers, proving persistence and synchronization.
4. World/NPC content, documents, JSON import, and legacy migration.
5. Combat, initiative, squads, snapshots/history using the same live state.
6. Maps and TV display. Design their data relationships early; implement their UI later.
7. Convenience features and broader resource management.

This proposed sequence replaces the original brief's assumption of a single-campaign local rebuild. Develop incrementally rather than scaffolding everything at once.

Deferred: billing, voice dictation/transcription for encounter logs, a complete automated D&D rules engine, a character builder, automatic D&D Beyond account sync, full offline editing, and support for additional rules systems. The user mentioned another later feature without defining it; do not guess what it is.

## Where to continue

Use [DECISIONS.md](DECISIONS.md) for agreement status and open questions, [ARCHITECTURE.md](ARCHITECTURE.md) for actual/proposed structure, and [PROGRESS.md](PROGRESS.md) for the next task. [PRODUCT_SPEC.md](PRODUCT_SPEC.md) preserves the first Hebrew specification.
