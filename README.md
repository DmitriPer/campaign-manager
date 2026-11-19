# campaign-manager

An Angular browser application for campaign preparation and shared live tabletop sessions, backed by Supabase. The workspace, database baseline and CI exist (T01); product features are not built yet. The repository also holds the project knowledge base and a preserved legacy HTML prototype.

## Run it

Requires Node.js 24 (see `.nvmrc`).

```bash
npm ci
```

```bash
cp .env.example .env.local
```

Fill in `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `.env.local` (both are public values; never put the database password or a secret key there). Then:

```bash
npm start
```

`npm test` runs the unit tests and `npm run build` makes a production build. Database tests and the full command list are in [Architecture → Commands](docs/ARCHITECTURE.md#commands).

## Start here

1. [AGENTS.md](AGENTS.md) — instructions for Codex and other coding agents.
2. [Project context](docs/PROJECT_CONTEXT.md) — purpose, users, scope, and workflows.
3. [Decisions](docs/DECISIONS.md) — confirmed choices, proposals, and open questions.
4. [Architecture](docs/ARCHITECTURE.md) — actual repository versus planned design.
5. [Progress and handoff](docs/PROGRESS.md) — completed work and next steps.
6. [Task plan](docs/TASKS.md) — implementation order and acceptance checks.
7. [Hebrew product specification](docs/PRODUCT_SPEC.md) — the initial detailed specification.
8. [Supporting references](docs/references/README.md) — original brief and legacy HTML, with provenance.

## Continue on another computer

Clone [this repository](https://github.com/DmitriPer/campaign-manager) using your authorized personal Git account, then open the repository root and follow `AGENTS.md`. Authentication is configured per computer; no SSH alias, credentials, or local path is required by the repository.

Only committed and pushed changes transfer through Git. Check the current working tree and remote state before switching computers. Commands are listed above and in the architecture document.

**Campaign Manager** is the working product name. **Adisdas** is reference campaign content, not the product's identity. The pilot stack is selected in the decision record. See the task plan for the next implementation step.
