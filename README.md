<p align="center">
  <img src="docs/assets/toksync-dashboard-preview.png" alt="TokSync dashboard preview" width="920" />
</p>

<h1 align="center">TokSync</h1>

<p align="center">
  Private-first AI coding usage sync for Codex CLI, Claude Code, and OpenCode.
  Metrics move across devices; prompts, replies, tool output, secrets, and raw
  project paths do not.
</p>

<p align="center">
  <a href="./README.zh-CN.md">中文</a>
  ·
  <a href="#quick-start">Quick start</a>
  ·
  <a href="#privacy-contract">Privacy contract</a>
  ·
  <a href="#roadmap-boundaries">Roadmap boundaries</a>
</p>

<p align="center">
  <img alt="stage" src="https://img.shields.io/badge/stage-v0.2-0f7b59?style=flat-square" />
  <img alt="payload" src="https://img.shields.io/badge/payload-metrics--only-315fbd?style=flat-square" />
  <img alt="public data" src="https://img.shields.io/badge/public%20data-opt--in-b66f09?style=flat-square" />
  <img alt="package manager" src="https://img.shields.io/badge/pnpm-9.15.9-f69220?style=flat-square" />
</p>

## What TokSync Is

TokSync v0.2 is a local-first telemetry hub for AI coding tools. It aggregates
token counts, approximate cost, model, source, device, and workspace-label usage
across machines while keeping private content out of the sync payload.

The product direction follows Tokscale's strong usage/profile/README embed loop,
but TokSync's default path is private multi-device aggregation. Public profile,
README badge/card, and any future leaderboard remain explicit opt-in layers.

## Current Console

| Surface            | Current behavior                                                |
| ------------------ | --------------------------------------------------------------- |
| Local agent        | `login`, token login, `status`, `sources list`, receipt dry-run |
| Collectors         | Codex CLI, Claude Code, and OpenCode-style JSON/JSONL fixtures  |
| API                | Device login, user API tokens, receipts, health, merge, export  |
| Storage            | `FileTokSyncStore` at `.tmp/toksync-dev.json` by default        |
| Web                | Dashboard, devices, health, receipts, merge, local viewer       |
| Public output      | README badge/profile-card SVG from public aggregate cache only  |
| Verification stack | Vitest, Playwright E2E, visual smoke, perf smoke, Turbo checks  |

## Quick Start

```bash
pnpm install
cp .env.example .env
pnpm db:reset
pnpm db:seed
pnpm dev
```

In another terminal:

```bash
pnpm agent login --auto-authorize demo
pnpm agent sync --dry-run --fixture ./packages/test-fixtures/codex/basic
pnpm agent sync --fixture ./packages/test-fixtures/codex/basic
```

The first sync inserts usage events. Repeating the same sync should skip the
same events instead of double-counting totals.

Headless/private sync can use a user API token created from settings or the API:

```bash
pnpm agent login --token tsu_...
TOKSYNC_API_TOKEN=tsu_... pnpm agent sync --fixture ./packages/test-fixtures/codex/basic
```

Default local services:

| Service | URL                   |
| ------- | --------------------- |
| Web     | http://localhost:3000 |
| API     | http://localhost:4000 |
| Worker  | http://localhost:4100 |

## Architecture

```text
apps/
  agent/       Commander CLI sync agent
  api/         Hono API service
  web/         Next.js App Router UI
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
for the hosted Postgres target.

## Privacy Contract

- Public profile is disabled by default.
- README badge/profile-card endpoints read public aggregate state only.
- Public output must not expose device names, raw paths, workspace hashes,
  source session ids, message ids, message text, tool arguments, or tool output.
- Device fingerprinting must not derive from hardware identifiers, hostname,
  username, home path, or project path.
- Cost is approximate usage estimation, not provider billing truth.
- Content sync, search, eval export, leaderboard, cost guardrails, vault, and
  proof-pack workflows are future opt-in features, not current behavior.

## Roadmap Boundaries

The external specs track Tokscale parity and TokSync-specific governance
features. The v0.2 private governance slice is implemented locally; later
public and cost-governance items remain scoped out:

| Phase | Planned capability   | Boundary                                       |
| ----- | -------------------- | ---------------------------------------------- |
| v0.2  | Merge Copilot        | Implemented as private duplicate-run summaries |
| v0.2  | Sync Privacy Receipt | Implemented with digest and safe field groups  |
| v0.2  | Source Health Radar  | Implemented for source sync status/freshness   |
| v0.2  | User API token       | Implemented for private/headless metrics sync  |
| v0.2  | Metrics export       | Implemented JSON/CSV without private IDs       |
| v0.3  | Cost Guardrails      | Flag spikes, unknown pricing, budget drift     |
| v0.4  | Private Usage Vault  | Encrypted metrics backup and restore           |
| v0.5  | Public Proof Pack    | Low-sensitivity public proof from aggregates   |

Leaderboard, billing, subscriptions, payment providers, plan limits, and billing
UI are out of scope for v0.1.

## Useful Commands

```bash
pnpm format:check
pnpm check:boundaries
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
pnpm test:visual
pnpm test:perf
pnpm test:full
```

Database/dev data:

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

## Project Docs

- Product specs: `E:\Project Code\docs\01 - Projects\TokSync`
- Current feature guide:
  `E:\Project Code\docs\01 - Projects\TokSync\03 - Guides\当前功能与使用指南.md`
- Latest docs change list:
  `E:\Project Code\docs\01 - Projects\TokSync\01 - Product\TokSync 文档变更清单.md`
- Agent guide: `AGENTS.md`

When external docs and code disagree, treat the docs as product intent and the
repository as current implementation truth. Update both when changing product
scope, API contracts, privacy boundaries, or data shape.
