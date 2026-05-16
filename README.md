# TokSync

TokSync v0.1 is a metrics-only telemetry hub for AI coding tools. It syncs token,
cost, model, source, device, and workspace-label usage across machines without
uploading prompts, assistant responses, tool arguments, tool output, file
content, secrets, or raw project paths.

The current repository is a working local v0.1 monorepo. It favors a fast,
file-backed development loop while keeping the Postgres schema and deployment
path documented for the hosted version.

## What Exists Now

- Local CLI agent with `login`, `logout`, `status`, `sources list`,
  `sync --dry-run`, and `sync`.
- TypeScript collectors for Codex CLI, Claude Code, and OpenCode-style usage
  files, plus synthetic fixtures.
- Hono API for device login, device-token auth, idempotent usage ingestion,
  dashboard queries, device deletion/revoke, and public profile settings.
- File-backed development repository at `.tmp/toksync-dev.json` by default.
- Forward SQL migration for the planned Postgres deployment path.
- Next.js dashboard, device authorization pages, docs pages, public profile,
  README badge, and README profile-card flows.
- SVG badge/profile-card renderer with public/private boundary tests.
- Vitest, Playwright E2E, visual smoke, and performance smoke coverage.
- `AGENTS.md` with project-specific guidance for future coding agents.

## v0.1 Scope

In scope:

- Metrics-only multi-device sync.
- Codex CLI, Claude Code, and OpenCode source adapters.
- Dry-run preview before upload.
- Idempotent usage ingestion and repeat-sync safety.
- Private dashboard rollups.
- Device revoke and device data deletion.
- Public profile opt-in.
- GitHub README SVG badge/profile card.

Out of scope for v0.1:

- Default conversation/content sync.
- Full-text or semantic search.
- Eval dataset export.
- Team workspace, RBAC, or organization reports.
- Leaderboard implementation.
- Billing, subscriptions, payment integration, plan limits, or billing UI.

## Architecture

```text
apps/
  agent/       CLI sync agent
  api/         Hono API service
  web/         Next.js app
  worker/      Worker/health surface
packages/
  shared/      Zod contracts, source ids, formatting, shared errors
  collector-core/
               Source discovery and UsageEventV1 normalization
  privacy/     Workspace hashing and metrics-only guards
  pricing/     Approximate cost estimation
  db/          Repository, local JSON store, migrations, seed/reset scripts
  embed-renderer/
               SVG badge and profile-card renderer
  test-fixtures/
               Synthetic parser fixtures
```

The active local store is `FileTokSyncStore`, controlled by `TOKSYNC_DB_FILE`.
`packages/db/migrations/0001_v0_1_metrics.sql` is the current forward SQL shape
for hosted Postgres.

## Quick Start

```bash
pnpm install
cp .env.example .env
pnpm db:reset
pnpm db:seed
pnpm dev
```

Default local services:

- Web: http://localhost:3000
- API: http://localhost:4000
- Worker health: http://localhost:4100

In another terminal:

```bash
pnpm agent login --auto-authorize demo
pnpm agent sync --dry-run --fixture ./packages/test-fixtures/codex/basic
pnpm agent sync --fixture ./packages/test-fixtures/codex/basic
```

The first sync should insert events. Repeating the same sync should skip the
same events rather than double-counting totals.

## Useful Commands

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
pnpm test:visual
pnpm test:perf
pnpm test:full
```

Database/dev data commands:

```bash
pnpm db:reset
pnpm db:seed
pnpm db:migrate
```

Agent examples:

```bash
pnpm agent status
pnpm agent sources list
pnpm agent logout
TOKSYNC_CONFIG_DIR=.tmp/toksync-agent pnpm agent status
```

## Privacy Rules

- Public profile is disabled by default.
- README badge/profile-card endpoints must only read public aggregate state.
- Public output must not expose device names, raw project paths, workspace
  hashes, source session ids, message ids, message text, tool arguments, or tool
  output.
- Device fingerprinting must not derive from hardware identifiers, hostname,
  username, home path, or project path.
- Content sync and leaderboard are future opt-in features, not v0.1 behavior.

## Documentation

- Project specs: `E:\Project Code\docs\01 - Projects\TokSync`
- Agent operating guide: `AGENTS.md`
- Current quick-start and repository status: this README

When external docs and code disagree, treat the docs as product intent and the
repository as current implementation truth. Update both when changing product
scope, API contracts, privacy boundaries, or data shape.
