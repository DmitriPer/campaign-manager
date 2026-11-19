# Decisions and open questions

Last reviewed: 2026-11-19. Entries summarize the conversation, inspected files, and initial specification. They are not reconstructed verbatim quotations or evidence of implementation.

Statuses: **Confirmed** = explicit user requirement/answer; **Selected for pilot** = planning choice made under the user’s delegated request; **Endorsed direction** = assistant proposal broadly accepted without resolving every detail; **Proposed** = design detail still subject to choice; **Superseded** = older direction replaced by a later requirement; **Open** = not yet decided. All entries below were recorded on 2026-11-19; precise times/order beyond the conversation are not invented.

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
| D22 | Route changes to the default branch and `dev` through pull requests. | User chose this workflow during the Linux handoff and reported configuring the ruleset. GitHub metadata confirms public visibility and `main` as the default. Effective rule enforcement remains unverified. |

## First pilot decisions

Planning choices made under the user's request to choose a coherent implementation plan. This records design intent. Provisioning and implementation are future tasks.

| ID | Selected for pilot | Rationale and consequence |
| --- | --- | --- |
| A01 | Angular standalone and built-in signals, ~~NestJS modular monolith, npm workspaces~~ (server parts superseded by A15). | Feature state and one deployable service keep the initial project small. Use Node 24 LTS and npm 11. A08 supersedes the earlier Angular 21 LTS and shared TypeScript 5.9 baseline. |
| A02 | PostgreSQL on Supabase ~~with Prisma migrations and an API-only application schema~~ (superseded by A16, A18). | The relational model, transactions and constraints directly cover membership, independent character copies and each action's audit trail. The database owns persistent state, and the Nest API owns permissions and read projections. |
| A03 | Supabase Auth with Google OAuth and a private PDF bucket; ~~local Supabase with Docker~~ (Docker optional per A19). | Managed sign-in and storage avoid operating login and file services. The first hosted pilot requires the owner's Google OAuth setup. Registration and fixture setup in CI use disposable local accounts. |
| A04 | ~~HTTP commands and SSE invalidations~~ with authorized snapshot recovery. **Superseded by A17**; the recovery model is kept. | Gameplay commands need reliable acknowledgements and retries, while delivery to another client is server-to-browser. Reconciliation handles stream gaps and notification loss. Begin with one server instance. |
| A05 | One active session per campaign, atomic join approval, one character per player/campaign and owner-or-DM live access. | Supports the first slice while leaving private invitations, membership removal, multiple characters, pause and TV projections for their own stages. Public discovery exposes the campaign name and description. |
| A06 | Manual character creation with optional private PDF; positive Max HP at approval, current HP begins unknown. | Users can save incomplete drafts. Requiring Max HP before approval keeps the play screen operable while out-of-session base edits remain deferred. Initializing or correcting current HP is an explicit in-session action. |
| A07 | ~~Single Render container for the hosted pilot~~, with a separate hosted Supabase project and synthetic staging data. **Superseded by A15** for hosting. | One origin simplifies deployment. Validate connectivity, idle behavior, recovery and cost in T09/T10 before real use. No service or paid plan has been provisioned. |
| A08 | Start with the latest stable Angular at scaffolding and keep it current through tested PRs. | User asked to use the latest release and plan continuing updates. Angular 22 is the stable major at this checkpoint. Verify compatibility and pin exact resolved versions in T01. Review monthly, prioritize security patches, and apply migrations one major at a time. |
| A09 | Use `main` for production, `dev` for next-release integration, and short-lived branches for changes. | Builds on D22. Promote through PRs, tag released commits with SemVer and return production fixes to `dev`. See [branch and release workflow](TASKS.md#ענפים-וגרסאות). |
| A10 | Store the campaign character copy in its own `CampaignCharacter` table, referenced by a content-free `CampaignActor`. | Architecture review, 2026-11-19, approved by the user for the docs fix. The spec already listed `CampaignCharacter`, while the pilot schema copied character fields into `CampaignActor`. A separate table keeps the actor table usable for NPC kinds later without player-character columns. |
| A11 | Base Max HP belongs to `CampaignCharacter`; `ActorState` holds an effective Max HP used as the live bound. | Architecture review, 2026-11-19. Resolves base-versus-live ambiguity. Initialized from the base at approval; changing the effective value is an explicit command. Q04 still decides how base edits propagate after the pilot. |
| A12 | `ActivityEvent.sessionId` is nullable. | Architecture review, 2026-11-19. Join approval and later out-of-session edits must be attributable too. Live-state commands still require the session. |
| A13 | Effects are child rows (`ActorEffect`) with stable UUIDs, not a JSON array. | Architecture review, 2026-11-19. Gives a stable removal target and constraints. Effect changes bump the parent `ActorState` version in the same transaction. |
| A14 | ~~Prisma Migrate is the only migration tool for app tables.~~ **Superseded by A18.** | Architecture review, 2026-11-19. Resolved an ambiguity in the NestJS/Prisma plan, which A15 later removed. |

### Stack revision: no custom server (2026-11-19)

The user, a solo developer, found the NestJS/Render plan too complex to follow and wants the pilot free. The user knows SQL and has worked with Vercel. They chose this direction in conversation on 2026-11-19 after the trade-offs were explained (status: **Confirmed**). Product decisions D01–D22, acceptance criteria AC-01–AC-08 and the schema shape in A10–A13 are unchanged. Angular stays (D01).

| ID | Decision | Rationale and consequence |
| --- | --- | --- |
| A15 | The pilot has no custom application server. An Angular single-page app talks directly to Supabase (PostgreSQL, Auth, Storage, Realtime). The app is static files on Vercel's Hobby plan. | Two moving parts instead of four, no idle-sleeping server, no cost at pilot scale. **Supersedes** the NestJS, npm-workspaces and shared-contracts parts of A01 and all of A07. Vercel Hobby is limited to non-commercial use, so a future fee (D04) requires a paid plan or another host. |
| A16 | Authorization is enforced inside PostgreSQL with Row Level Security and database functions. Browser roles get read access only through RLS-protected tables/views; every write goes through a database function (RPC). DM-only and owner-only data live in separate tables so row-level policies can hide them. | Keeps server-side enforcement (AGENTS invariant) without a server process. **Supersedes** A02's "API-only schema, Nest owns permissions". Rules are written in SQL, which the user knows and can review. |
| A17 | Live commands (damage, heal, setHp, effects, session start/end, join decisions) are PL/pgSQL functions that check role and session, take row locks, apply idempotency receipts and versions, and write the activity event in one transaction. Supabase Realtime sends a minimal "changed" signal on a private, membership-authorized channel; clients then re-read authorized state. | Same reliability rules as before, moved into the database. **Supersedes** A04 (HTTP commands plus SSE through Nest). The exact Realtime mechanism (Broadcast from the database with Realtime Authorization, or Postgres Changes) is validated in T02 (spike with real users) and T07 before relying on it. |
| A18 | Schema, policies and functions are plain SQL migrations managed with the Supabase CLI and tested with pgTAP. TypeScript types are generated from the database. | Prisma needs a Node server and is no longer used. **Supersedes** A14 and the Prisma part of A02. |
| A19 | Local Docker is optional. Development uses a free hosted Supabase project; CI runs the Supabase CLI stack on GitHub's runners (which provide Docker) for migration, policy and race tests. A second free project is reserved for the hosted pilot. | Lowers setup for the user. **Supersedes** the "local Supabase with Docker" part of A03. Local Docker is recommended once writing policy tests, because it allows resetting the database freely. |
| A20 | PDF uploads go directly to a private Supabase Storage bucket guarded by storage policies, with a bucket size limit of 10 MiB and `application/pdf` as the allowed type. Downloads use short-lived signed URLs for the owner only. | Without a server, file content cannot be inspected before it is stored; the MIME type is client-declared. Accepted for the pilot because only the owner can ever download the file. A server-side check (for example an Edge Function) can be added later. Partially **supersedes** the PDF handling in the pilot architecture. |

Free-tier constraints checked on 2026-11-19 from the providers' pages: Supabase Free gives two projects, 500 MB database per project, 1 GB file storage, 200 Realtime peak connections, and pauses a project after one week of inactivity ([Supabase pricing](https://supabase.com/pricing)). Vercel Hobby is personal/non-commercial only ([Vercel Hobby](https://vercel.com/docs/plans/hobby), [fair use](https://vercel.com/docs/limits/fair-use-guidelines)). Re-check before the hosted pilot.

See [architecture](ARCHITECTURE.md#first-pilot-architecture) and [tasks](TASKS.md).

## Endorsed directions and proposed implementation details

| ID | Status | Direction / rationale |
| --- | --- | --- |
| P01 | Endorsed direction | Activity log, correction of mistakes, visible connection/save state, safe concurrency/retries, and reconnection recovery. These support reliable live play. |
| P02 | Endorsed direction | Track live resources/effects in addition to HP; explicit rest actions, optional effect metadata/reminders, and no complete automatic rules engine initially. |
| P03 | Endorsed direction | Pause/resume, session summaries, mobile player access, map pings, handout sharing, quick search, and private/shared notes; stage convenience work after the core. |
| P04 | Superseded | Earlier architecture proposed NgRx SignalStore and broader package boundaries. A01–A04 (as amended) and A15–A20 define the pilot baseline. |
| P05 | Selected for pilot | Use `CampaignActor` and canonical `ActorState` for player characters. Maps and encounters will reference the same identity when implemented. A10–A13 refine the table split. |
| P06 | Selected for pilot | Server-authoritative commands, operation IDs, versions for absolute edits and transactional state plus activity events. A17 selects the delivery and recovery model (database functions plus Realtime signals). |
| P07 | Selected for pilot | Block live edits when disconnected in the first version; reconnect to authoritative state. Full offline editing is deferred. |
| P08 | Proposed | Planned and paused states are a later extension. A05 defines the pilot active/ended lifecycle. |
| P09 | Proposed | Owner moves own map token if DM allows; DM can lock movement. Exact controls not finalized. |
| P10 | Proposed | Versioned JSON envelope, source-scoped external IDs, preview, add/update modes, atomic import with concurrent-change detection. Exact schema and limits remain open. |
| P11 | Proposed | PDF extraction as a convenience, followed by user review/manual correction. No sample files or extractor selected. |
| P13 | Superseded | The previous first-slice planning defaults were incorporated into A05–A06 and the v0.3 product spec. |

## Superseded directions and legacy differences

| Previous assumption/behavior | Current direction |
| --- | --- |
| Adisdas-branded rebuild for one DM | General multi-user Campaign Manager; Adisdas is reference content. |
| Initially only local use, possibly SQLite | Multi-device and shared sessions; central database required; Supabase PostgreSQL selected for the pilot (A02, A15). |
| Four fixed players automatically added to every combat | Campaign roster varies; DM chooses encounter participants. |
| Update all past encounter rows when player HP changes | Current views share live state; historical snapshots preserve values from their time. |
| Restoring a legacy encounter also restores player HP | History viewing is isolated; explicit restore semantics must be deliberately designed. |
| Earlier recommendation for a private GitHub repository | GitHub reports public visibility. See D22 for the branch workflow. |
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
| Q03 | Exact paused behavior, content-edit exceptions, and whether ended sessions can reopen after the pilot (A05). | Session lifecycle implementation |
| Q04 | How to handle new Max HP below current HP outside a session, after the pilot. A06 defines initialization for the pilot. | HP/base-data commands |
| Q05 | D&D edition(s), supported PDF variants and sample PDFs for extraction. A06 defines the pilot manual path. | Rules-specific schema and PDF parser |
| Q06 | Which character details, notes, HP/resource values, and files are visible to party members, discovery viewers, and the TV beyond the pilot projections (A05)? | Read models and public profiles |
| Q07 | Display pairing, expiration/revocation, and authorized map/token projection behavior. | Player display implementation |
| Q08 | Initiative ties, adding/removing the current participant, changing initiative mid-round, dead/unconscious turn handling, and squad edge cases. | Combat domain rules |
| Q09 | Data export/backup/restore scopes and access rules; correction/restore policy when newer edits exist. | Export, history restore, correction UI |
| Q10 | Pin compatible patches at T01. Validate actual hosted limits and inactivity pausing at T09/T10. A15–A20 select the pilot stack. | Infrastructure selections |
| Q11 | Final JSON schemas, explicit-clear semantics, reference mapping, namespace rules, validation and size limits. | Import implementation |
| Q12 | Whether a newer legacy JSON backup exists. The supplied HTML contains seed data, not browser-local changes. | Final migration |
| Q13 | What is the final public-facing product name? Repository visibility was separately verified as public (D22). | Public product launch |
| Q14 | The additional late-stage feature mentioned by the user was never specified. | Planning that extension |

## Updating this record

Add a date, source/basis, consequence, and status when making a significant decision. Link resolved questions to their new decision entry. If an implementation diverges, document it and reconcile the other knowledge-base files. An assistant recommendation or an installed dependency is not, by itself, evidence that all related product choices were approved.
