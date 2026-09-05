<p align="center">
  <img src="docs/assets/toksync-dashboard-preview.png" alt="TokSync dashboard preview" width="920" />
</p>

<h1 align="center">TokSync</h1>

<p align="center">
  Private-first AI coding usage sync for Codex CLI, Claude Code, OpenCode,
  Cursor, Copilot, Gemini CLI, and OpenClaw.
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
  <img alt="stage" src="https://img.shields.io/badge/stage-v0.6-0f7b59?style=flat-square" />
  <img alt="payload" src="https://img.shields.io/badge/payload-metrics--only-315fbd?style=flat-square" />
  <img alt="public data" src="https://img.shields.io/badge/public%20data-opt--in-b66f09?style=flat-square" />
  <img alt="package manager" src="https://img.shields.io/badge/pnpm-9.15.9-f69220?style=flat-square" />
</p>

## What TokSync Is

TokSync is a local-first telemetry hub for AI coding tools. It aggregates token
counts, approximate cost, model, source, device, and workspace-label usage
across machines while keeping private content out of the sync payload.

The product direction follows Tokscale's strong usage/profile/README embed loop,
but TokSync's default path is private multi-device aggregation. Public profile,
README badge/card, and leaderboard remain explicit opt-in layers.

Current simplification work narrows the authenticated app to five primary
surfaces: Dashboard, Sync, Sources, Share, and Settings. Old authenticated app
routes stay available through compatibility redirects into those task centers,
while public `/leaderboard`, public APIs, SVG URLs, and metrics-only data
contracts remain unchanged.

## Current Console

Latest review and fixes: [2026-09-05 changelog](docs/changelog/CHANGELOG.md#2026-09-05-review-and-reliability-hardening).

| Surface            | Current behavior                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local agent        | `login`, token login, `status`, `sources list`, `report models/sources/daily/monthly/hourly`, receipt dry-run, explicit `sync --yes`, encrypted token storage                                          |
| Collectors         | Codex CLI, Claude Code, OpenCode, Cursor CSV, Copilot OTEL JSONL, Gemini tmp chats, OpenClaw session/SDK usage logs                                                                                    |
| API                | 48 `/v1` handlers plus `GET /health`, covering GitHub OAuth, device login, user API tokens, receipts, merge, export, guardrails, pricing audit, leaderboard, vault, Proof Pack, Wrapped, and share SVG |
| Storage            | `FileTokSyncStore` at `.tmp/toksync-dev.json` by default; Postgres and queue-backed hosted runtime work is parked until a separate decision                                                            |
| Web                | Primary navigation is Dashboard, Sync, Sources, Share, and Settings; old authenticated app URLs redirect to the new task centers and public pages remain available                                     |
| Public output      | README badge/profile-card/share SVG, Public Proof Pack, and public Wrapped card from public cache / receipt digest only                                                                                |
| Verification stack | Vitest, Playwright E2E, visual smoke, perf smoke, Turbo checks                                                                                                                                         |

## Quick Start

Connect the agent, preview the metrics-only payload, then sync:

```bash
toksync login
toksync sync --dry-run
toksync sync
```

The preview shows event count, tokens, estimated cost, sources, date range, and
the privacy receipt before any upload. An interactive device login asks for
confirmation; a successful sync prints the Dashboard URL.

## Developer Setup

```bash
pnpm install
cp .env.example .env
pnpm db:reset
pnpm db:seed
pnpm dev
```

`pnpm dev` starts the Web and API apps. Start the worker only when you need the
explicit worker process:

```bash
pnpm dev:worker
```

Local browser/dev auth is explicit. Keep `TOKSYNC_DEV_AUTH=1` in `.env` for
`--auto-authorize demo` and `X-TokSync-User` based local Web requests; leave it
unset or `0` for hosted/prod-like auth checks. Device codes default to 900
seconds and can be tuned with `DEVICE_CODE_TTL_SECONDS`.

In another terminal:

```powershell
$onboardingConfig = Join-Path (Get-Location) ".tmp/toksync-onboarding"
if (Test-Path -LiteralPath $onboardingConfig) {
  Remove-Item -LiteralPath $onboardingConfig -Recurse -Force
}
$env:TOKSYNC_CONFIG_DIR = $onboardingConfig
corepack pnpm agent login --auto-authorize demo
corepack pnpm agent sync --dry-run --fixture ./packages/test-fixtures/codex/basic
corepack pnpm agent sync --fixture ./packages/test-fixtures/codex/basic --yes
```

The first sync inserts usage events. Repeating the same sync should skip the
same events instead of double-counting totals.

Hosted or private headless sync uses a real API endpoint plus a user API token
created from settings or the API:

```bash
TOKSYNC_API_URL=https://your-toksync-api.example.com \
pnpm agent login --token tsk_...
TOKSYNC_API_URL=https://your-toksync-api.example.com \
TOKSYNC_API_TOKEN=tsk_... \
pnpm agent sync --yes
```

`TOKSYNC_API_TOKEN` is treated as a one-shot process input and is cleared from
the current agent process after it is read. Device login stores `deviceToken` as
`deviceTokenEncrypted` in `config.json` with AES-256-GCM and a local
`config.key`; legacy plaintext config files load and migrate on the next save.
Non-interactive device-token uploads must pass `--yes`; user API token uploads
are the explicit headless path.

Local reports can be generated without opening the Web dashboard:

```bash
pnpm agent report models --fixture ./packages/test-fixtures/codex/basic
pnpm agent report daily --fixture ./packages/test-fixtures/codex/basic --format json
```

Default local services:

| Service | URL                   |
| ------- | --------------------- |
| Web     | http://localhost:3000 |
| API     | http://localhost:4000 |
| Worker  | http://localhost:4100 |

The worker URL is available only after `pnpm dev:worker`. The root `pnpm dev`
script starts only Web and API.

## Architecture

```text
apps/
  agent/       Commander CLI sync agent
  api/         Hono API service
  web/         Next.js App Router UI
  worker/      Optional worker/health surface

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
`packages/db/migrations/0001_v0_1_metrics.sql` documents the current forward SQL
shape, but Postgres runtime parity and queue-backed worker processing are parked
until a hosted persistence decision is made. Vault artifacts stay inline in the
local file store by default, or can be written to a private object directory
with `TOKSYNC_VAULT_ARTIFACT_DIR`.

API rate limiting uses an in-process store for local development. Set
`TOKSYNC_RATE_LIMIT_REDIS_URL=redis://...` or `rediss://...` before
multi-instance hosted deployment to share counters across instances.

## Privacy Contract

- Public profile is disabled by default.
- README badge/profile-card, Public Proof Pack, and public Wrapped endpoints read public aggregate state or receipt digest only.
- Public output must not expose device names, raw paths, workspace hashes,
  source session ids, message ids, message text, tool arguments, or tool output.
- Workspace/project labels are private by default and may appear in public
  output only after an explicit user allow decision.
- Device fingerprinting must not derive from hardware identifiers, hostname,
  username, home path, or project path.
- Cost is approximate usage estimation, not provider billing truth.
- Cost Guardrails are private-only and never feed public profile, README SVG, or
  leaderboard output.
- Leaderboard participation requires public profile plus a second explicit
  opt-in, reads public aggregate cache only, and is global-only.
- Private Usage Vault encrypts metrics-only artifacts with a user recovery
  passphrase of at least 16 characters; new exports record explicit scrypt
  parameters and can be downloaded/imported across instances with idempotent
  duplicate handling.
- Content sync, search, and eval export remain future opt-in features, not
  current behavior.

## Roadmap Boundaries

The current implementation already has a broad feature surface. The active
roadmap keeps the five primary app surfaces small and preserves compatibility
redirects. S6 API/repository cleanup has an audit result but no unsafe removals;
S7 hosted persistence remains a separate decision until there is deployment
evidence, parity testing, migration verification, and rollback scope.

| Phase | Planned capability   | Boundary                                                                                                                                                                            |
| ----- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.1  | Public label privacy | Implemented as private-by-default labels with explicit public toggle and safe-label filtering                                                                                       |
| v0.2  | Merge Copilot        | Implemented as private duplicate-run summaries                                                                                                                                      |
| v0.2  | Sync Privacy Receipt | Implemented with digest and safe field groups                                                                                                                                       |
| v0.2  | Source Health Radar  | Implemented for source sync status/freshness                                                                                                                                        |
| v0.2  | GitHub OAuth         | Implemented as first production browser login; email magic link deferred                                                                                                            |
| v0.2  | User API token       | Implemented for private/headless metrics sync                                                                                                                                       |
| v0.2  | Metrics export       | Implemented JSON/CSV without private IDs                                                                                                                                            |
| v0.3  | Cost Guardrails      | Implemented for private budget, spike, unknown-pricing alerts                                                                                                                       |
| v0.3  | Leaderboard          | Implemented global-only; source/model subboard queries are rejected                                                                                                                 |
| v0.4  | Source parity        | Implemented Cursor usage CSV, Copilot OTEL, Gemini tmp chats, and OpenClaw usage log parsing                                                                                        |
| v0.4  | Private Usage Vault  | Implemented passphrase-encrypted metrics backup, artifact storage, preview, and import                                                                                              |
| v0.4+ | Stabilization gate   | FileStore repository mutation transactions, parser/component coverage, token encryption, Redis limit switch                                                                         |
| v0.5  | Public Proof Pack    | Implemented public API; old `/app/proof-pack` redirects to `/app/share?tab=proof` compatibility view                                                                                |
| v0.5  | Wrapped              | Implemented private/public APIs; old `/app/wrapped` redirects to `/app/share?tab=wrapped` compatibility view                                                                        |
| v0.6  | CLI reports          | Implemented local `report` views for models, sources, daily, monthly, hourly, table, JSON, and source filter                                                                        |
| v0.6  | Public profile/share | Implemented public profile section tabs, owner controls, share SVG, and README badge/card/share parameters; primary authenticated entry is `/app/share` with toggle, Save, and Copy |
| v0.6  | Leaderboard UX       | Implemented public `/leaderboard`, cost metric, search, period tabs, current-user rank, and old `/app/leaderboard` redirect to `/app/share?tab=leaderboard`                         |
| v0.6  | Settings/pricing UX  | Implemented account status, copy-once token UX, token revoke metadata, and model pricing audit queue                                                                                |

Billing, subscriptions, payment providers, plan limits, billing UI, content
sync, search, eval export, and source/model leaderboard subboards remain out of
scope.

## Useful Commands

```bash
pnpm format:check
pnpm check:boundaries
pnpm typecheck
pnpm lint
pnpm test
pnpm test:coverage
pnpm build
pnpm test:e2e
pnpm test:e2e:hosted
pnpm test:visual
pnpm test:perf
pnpm test:full
```

Use the root Playwright wrappers, `pnpm test:e2e`, `pnpm test:e2e:hosted`, and
`pnpm test:visual`, for normal verification. They allocate per-run API/Web
ports, JSON store, agent config, Next output, and Playwright output paths.
Direct concurrent `playwright test` runs are unsupported unless each run
provides isolated `TOKSYNC_PLAYWRIGHT_*` paths and ports.

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
pnpm agent report models --fixture ./packages/test-fixtures/codex/basic
pnpm agent report hourly --fixture ./packages/test-fixtures/codex/basic --source codex --format table
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
