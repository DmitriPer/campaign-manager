# Decisions and open questions

Last reviewed: 2026-11-19. Entries summarize the conversation, inspected files, and initial specification. They are not reconstructed verbatim quotations or evidence of implementation.

Statuses: **Confirmed** = explicit user requirement/answer; **Endorsed direction** = assistant proposal broadly accepted without resolving every detail; **Proposed** = design detail still subject to choice; **Superseded** = older direction replaced by a later requirement; **Open** = not yet decided. All entries below were recorded on 2026-11-19; precise times/order beyond the conversation are not invented.

## Confirmed decisions

| ID | Decision | Basis and consequence |
| --- | --- | --- |
| D01 | Use Angular for the new application. | Explicit user request. The reason for preferring it over React was deferred; no rationale should be invented. |
| D02 | General campaign-management product; working name Campaign Manager. | User rejected Adisdas as the product name. Adisdas remains reference campaign content. Final branding is open. |
| D03 | Support multiple devices and eventual registered users. | User selected multi-device access and then described DM/player accounts. Browser-local persistence alone is insufficient. |
| D04 | Free initially; possible modest future server/support fee. | Explicit product goal. No billing implementation/provider selected. |
| D05 | Roles are campaign-specific. | Any user can create/manage a campaign and participate in others. Do not encode a single permanent DM/player role on the account. |
| D06 | Independent version of a character per campaign. | Explicit acceptance of the proposed separation. Damage, gear, and progression in one campaign do not propagate to another or the original library character. |
| D07 | Owner and DM may update a character's live state during a session. | Explicit acceptance; DM sees player changes in real time. Attributed changes were part of the accepted proposal. |
| D08 | Public campaign admission requires request and DM approval. | Explicit answer. Public visibility does not mean automatic membership. |
| D09 | Campaigns and characters have configurable visibility. | User described private, selected people/campaigns, and public discovery. Exact field visibility remains open. |
| D10 | Character onboarding uses D&D Beyond PDF and manual completion. | Explicit user requirement. A full character builder is not required. Automatic extraction is not yet proven or required as the only input path. |
| D11 | Separate preparation from live session operation. | Outside sessions: content/base-data edits. During sessions: live HP/effects and runtime operations, with content-authoring locked. Edge cases remain open. |
| D12 | End-of-session state persists. | Explicit requirement: current HP and effects remain exactly as at the end. Starting a new encounter/session must not reset them. |
| D13 | Sessions are numbered for tracking. | Explicit user requirement; internal IDs and numbering policy are proposed implementation details. |
| D14 | DM selects combat participants; not all players must participate. | Explicit correction to legacy behavior. Map context may help selection. |
| D15 | Live changes are consistent across character/NPC cards and combat. | Explicit requirement. A canonical live actor state is the proposed mechanism. |
| D16 | Dedicated live map/player display remains active as DM switches tabs. | Explicit desktop-plus-TV workflow. DM controls exposed actors/content and positions. |
| D17 | Nested world locations and associated maps/documents. | Explicit hierarchy examples. Flexible parent-child locations proposed instead of fixed nesting levels. |
| D18 | Bulk JSON entry and legacy-content preservation. | Initial request and attached brief. Incremental import must be distinct from full backup restore. |
| D19 | Plan carefully and implement in stages; maps later. | User emphasized a previous planning failure and requested planning first. Design map relationships now, UI later. |
| D20 | Use the personal project repository, separate from work Git. | User created the repository and authorized connecting the local project. Do not carry machine-specific account/SSH configuration into source control. |
| D21 | Maintain a portable, persistent project knowledge base. | Current request: required documentation, supporting references, startup/update instructions, no application functionality changes, no credentials or machine-specific config. |

## Endorsed directions and proposed implementation details

| ID | Status | Direction / rationale |
| --- | --- | --- |
| P01 | Endorsed direction | Activity log, correction of mistakes, visible connection/save state, safe concurrency/retries, and reconnection recovery. These support reliable live play. |
| P02 | Endorsed direction | Track live resources/effects in addition to HP; explicit rest actions, optional effect metadata/reminders, and no complete automatic rules engine initially. |
| P03 | Endorsed direction | Pause/resume, session summaries, mobile player access, map pings, handout sharing, quick search, and private/shared notes; stage convenience work after the core. |
| P04 | Proposed | Standalone Angular feature UI with NgRx SignalStore, NestJS API, PostgreSQL, private asset storage, shared contracts/domain code. No scaffolding, versions, or providers chosen. |
| P05 | Proposed | `CampaignActor` plus canonical `ActorState` referenced by maps and encounters. Table split is not final. |
| P06 | Proposed | Server-authoritative commands, operation IDs, versions for absolute edits, transactional state+activity events, post-commit audience-filtered delivery. Transport and delivery guarantees require design. |
| P07 | Proposed | Block live edits when disconnected in the first version; reconnect to authoritative state. Full offline editing is deferred. |
| P08 | Proposed | Session states planned/active/paused/ended; at most one active/paused session per campaign; paused mutations blocked. User has not specifically approved these detailed constraints. |
| P09 | Proposed | Owner moves own map token if DM allows; DM can lock movement. Exact controls not finalized. |
| P10 | Proposed | Versioned JSON envelope, source-scoped external IDs, preview, add/update modes, atomic import with concurrent-change detection. Exact schema and limits remain open. |
| P11 | Proposed | PDF extraction as a convenience, followed by user review/manual correction. No sample files or extractor selected. |
| P12 | Proposed | Private repository was recommended. Repository access was verified; visibility was not independently verified. Do not state privacy as a confirmed technical fact. |

## Superseded directions and legacy differences

| Previous assumption/behavior | Current direction |
| --- | --- |
| Adisdas-branded rebuild for one DM | General multi-user Campaign Manager; Adisdas is reference content. |
| Initially only local use, possibly SQLite | Multi-device and shared sessions; central server/DB required, PostgreSQL proposed. |
| Four fixed players automatically added to every combat | Campaign roster varies; DM chooses encounter participants. |
| Update all past encounter rows when player HP changes | Current views share live state; historical snapshots preserve values from their time. |
| Restoring a legacy encounter also restores player HP | History viewing is isolated; explicit restore semantics must be deliberately designed. |
| One undifferentiated character record reused everywhere | Personal original plus independent campaign-specific versions. |
| Original brief's feature order: World/NPCs then Players then Combat | Later proposed order establishes identity/membership and proves shared live state early, then expands content/combat/maps. |
| Everything in one HTML/state/localStorage blob | Modular UI/domain/server/persistence boundaries are the target, not yet implemented. |

The references preserve old behavior for migration analysis; they are not instructions to reintroduce superseded behavior.

## Open questions

Resolve each before the implementation slice that depends on it. These are planning questions, not claims that all work is blocked.

| ID | Question | Needed before |
| --- | --- | --- |
| Q01 | Can owners change campaign character level/stats/equipment freely outside sessions, or does the DM approve some changes? | Character-edit authorization |
| Q02 | What remains accessible to a player and DM after departure/removal, deletion of the personal original, or character privacy changes? Who can retain/export campaign copies? | Membership removal and deletion |
| Q03 | Exact paused behavior, content-edit exceptions, one-open-session limit, and whether ended sessions can reopen. | Session lifecycle implementation |
| Q04 | How to handle new Max HP below current HP outside a session, and where unknown HP may be initialized, without violating the session-only live-edit rule. | HP/base-data commands |
| Q05 | D&D edition(s), supported PDF variants, sample PDFs, extraction/manual fallback fields. | Rules-specific schema and PDF parser |
| Q06 | Which character details, notes, HP/resource values, and files are visible to party members, discovery viewers, and the TV? | Read models and public profiles |
| Q07 | Display pairing, expiration/revocation, and authorized map/token projection behavior. | Player display implementation |
| Q08 | Initiative ties, adding/removing the current participant, changing initiative mid-round, dead/unconscious turn handling, and squad edge cases. | Combat domain rules |
| Q09 | Data export/backup/restore scopes and access rules; correction/restore policy when newer edits exist. | Export, history restore, correction UI |
| Q10 | Hosting/auth provider, ORM, asset storage, quotas/file limits, runtime/package versions, real-time transport, operational costs. | Infrastructure selections |
| Q11 | Final JSON schemas, explicit-clear semantics, reference mapping, namespace rules, validation and size limits. | Import implementation |
| Q12 | Whether a newer legacy JSON backup exists. The supplied HTML contains seed data, not browser-local changes. | Final migration |
| Q13 | Visibility of the GitHub repository was not verified; public product branding remains undecided. | Any assumption of privacy or public launch |
| Q14 | The additional late-stage feature mentioned by the user was never specified. | Planning that extension |

## Updating this record

Add a date, source/basis, consequence, and status when making a significant decision. Link resolved questions to their new decision entry. If an implementation diverges, document it and reconcile the other knowledge-base files. An assistant recommendation or an installed dependency is not, by itself, evidence that all related product choices were approved.
