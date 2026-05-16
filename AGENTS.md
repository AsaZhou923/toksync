# TokSync Agent Guide

This guide is based on the project notes in `E:\Project Code\docs\01 - Projects\TokSync`
and the repository state in `E:\Project Code\toksync` as of 2026-05-16.

When docs and code disagree, use this rule:

- The external docs describe product intent and target architecture.
- The repository describes what is currently implemented.
- If a change alters product scope, API contracts, privacy boundaries, or data shape, update the relevant external spec docs as part of the same work.

## Mission

TokSync is a metrics-only telemetry hub for AI coding tools. It aggregates token,
cost, model, source, device, and workspace-label usage across machines while
avoiding upload of prompts, assistant replies, tool arguments, tool output, file
content, and raw project paths.

The v0.1 loop is:

1. Local agent discovers and parses usage metrics from Codex CLI, Claude Code, and OpenCode.
2. Agent dry-runs or syncs a `UsageBatchV1` payload.
3. Hono API ingests idempotent metrics.
4. Storage recomputes dashboard and public-profile aggregates.
5. Next.js dashboard and public SVG embed endpoints display private or explicitly public aggregates.

## Hard Product Boundaries

- Metrics-only is the default and the MVP. Do not add content sync UI or active content upload without an explicit product decision.
- Never include prompt text, assistant response text, tool arguments, tool output, file content, secrets, raw absolute project paths, source session details, or message text in public output.
- Public profile is opt-in. README badge/profile-card data must come only from public aggregate state, not private raw events.
- Leaderboard is not v0.1. If touched, it must remain opt-in and use public aggregate snapshots only.
- Billing, subscription plans, payment providers, paid limits, and billing UI are out of scope for v0.1.
- Cost estimates are approximate; do not present them as provider billing truth.
- Device fingerprinting must not use hostname, MAC address, OS machine id, username, home path, or project path. It should derive from a local random seed and server-side pepper.

## Current Implementation Snapshot

- Package manager: `pnpm@9.15.9`.
- Runtime stack: TypeScript, Node 22-style ESM, Turbo, Vitest, Playwright.
- Apps:
  - `apps/agent`: Commander CLI with `login`, `logout`, `status`, `sources list`, and `sync`.
  - `apps/api`: Hono API with device login, sync ingestion, dashboard queries, device revoke/delete, public profile, badge, and embed routes.
  - `apps/web`: Next.js app for landing, dashboard, docs, device auth, public profile, and embed settings.
  - `apps/worker`: lightweight worker/health surface; rollup work is currently synchronous in the repository layer.
- Packages:
  - `packages/shared`: Zod schemas, source registry, formatting, and shared errors.
  - `packages/collector-core`: source discovery, JSON/JSONL parsing, normalization to `UsageEventV1`.
  - `packages/privacy`: workspace hashing, opaque-value hashing, metrics-only payload checks.
  - `packages/pricing`: approximate model pricing and cost estimation.
  - `packages/db`: repository, local JSON store, data types, seed/reset/migrate scripts, and forward SQL migration.
  - `packages/embed-renderer`: SVG badge and profile-card rendering.
- Current local persistence is `FileTokSyncStore`, defaulting to `.tmp/toksync-dev.json` or `TOKSYNC_DB_FILE`.
- A Postgres migration exists in `packages/db/migrations/0001_v0_1_metrics.sql`, but the active dev repository path is still file-backed unless code proves otherwise.
- The repo may be in a broad untracked or dirty state. Always check `git status --short` before editing and do not revert user changes.

## Source Of Truth Files

- Product overview: `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\overview.md`
- Product requirements: `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\prd.md`
- Architecture: `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\architecture.md`
- API design: `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\api-design.md`
- Database design: `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\database-design.md`
- Auth and permission: `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\auth-and-permission.md`
- Local development: `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\local-development.md`
- Testing strategy: `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\testing.md`
- Current repo README: `README.md`

## Package Boundaries

- `packages/shared` owns public TypeScript/Zod contracts. Update schema tests when changing `UsageEventV1`, `UsageBatchV1`, public profile input, source ids, or error shape.
- `packages/collector-core` parses local files and normalizes events. It must not call the cloud API directly.
- `packages/privacy` owns hashing/redaction rules. Privacy-sensitive behavior belongs here or in tests that assert this package's guarantees.
- `packages/pricing` owns approximate pricing. Add tests for any new model pricing or rounding behavior.
- `packages/db` owns repository semantics: auth token hash checks, idempotency, sync runs, rollup recompute, device deletion, and public aggregate refresh.
- `packages/embed-renderer` returns SVG strings only. Escape untrusted text and validate colors.
- `apps/agent` owns local CLI behavior, config loading, device fingerprint creation, dry-run output, and upload calls.
- `apps/api` owns HTTP shape, auth extraction, and response headers. It should delegate storage behavior to `TokSyncRepository`.
- `apps/web` owns UI. It should call API helpers and must not import collectors or directly mutate storage.
- `apps/worker` should own async background work once rollups/export jobs become real. Do not duplicate repository logic there prematurely.
- Packages must not import from apps.

## Data Contracts

Keep these stable unless the change is intentional and documented:

- Built-in sources: `codex`, `claude`, `opencode`.
- `UsageEventV1` must include `schemaVersion`, `source`, source session/message identifiers, `dedupKey`, `deviceId`, optional workspace hash/label, `modelId`, optional provider, timestamps, token breakdown, optional cost, message count, and turn marker.
- `UsageBatchV1` must include `schemaVersion`, `runId`, device metadata, `mode`, source versions, and max 10,000 events.
- Sync idempotency depends on `(user_id, source, dedup_key)` semantics. Any adapter change must preserve stable dedup keys and include replay tests.
- Wrong-device events must be rejected or counted as per-event errors, not silently accepted.
- `POST /v1/sync/content-batch` is intentionally a feature-disabled placeholder for MVP.

## Privacy And Public Data Rules

Required private/public separation:

- Private dashboard may read user-owned events and aggregates.
- Public profile, badge, and embed must read public aggregate state only.
- Public output must not expose device name, raw project path, workspace hash, source session id, message id, message text, tool arguments, or tool output.
- `public_profile_enabled` defaults to false.
- Cost display is controlled by `showCost`.
- Source/model breakdown display is controlled by `showSourceBreakdown` and `showModelBreakdown`.
- Device deletion must remove that device's usage events and refresh private and public aggregates.

Forbidden metrics payload fields are represented in `packages/privacy/src/index.ts`.
If a source adapter could accidentally pass through raw records, add or strengthen
tests that serialize the batch and assert forbidden strings are absent.

## Local Development

Default setup:

```bash
pnpm install
cp .env.example .env
pnpm db:reset
pnpm db:seed
pnpm dev
```

Default local services:

- Web: `http://localhost:3000`
- API: `http://localhost:4000`
- Worker health: `http://localhost:4100`

Useful agent loop:

```bash
pnpm agent login --auto-authorize demo
pnpm agent sync --dry-run --fixture ./packages/test-fixtures/codex/basic
pnpm agent sync --fixture ./packages/test-fixtures/codex/basic
```

For isolated agent config during development:

```bash
TOKSYNC_CONFIG_DIR=.tmp/toksync-agent pnpm agent status
```

On Windows PowerShell, use `-LiteralPath` for bracketed Next.js paths such as
`apps\web\app\u\[username]\page.tsx`.

## Verification Commands

Choose the smallest verification set that proves the change. For broad changes,
run the full chain.

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

Expected coverage by change type:

- Shared schema or API contract: `pnpm typecheck`, `pnpm test`, relevant API tests.
- Collector changes: fixture tests, snapshot updates only when the new output is intentionally changed, privacy assertions, and dry-run against synthetic fixtures.
- Repository/storage changes: idempotency, replay, wrong-device, revoke, delete, rollup recompute, and public stats tests.
- SVG/embed changes: renderer tests plus Playwright visual sanity checks or pixel checks.
- Web UI changes: `pnpm --filter @toksync/web typecheck`, `pnpm build`, and Playwright/browser verification for affected flows.
- Agent CLI changes: dry-run and sync fixture loop, status/logout behavior, token/revoke failure path.

Do not claim completion from a build alone when the change affects UI, sync behavior,
privacy, or public SVG output. Verify the actual artifact or route.

## Testing Priorities

Prioritize these over cosmetic coverage:

1. Parser correctness for source fixtures.
2. Sync idempotency and replay safety.
3. Metrics-only privacy boundaries.
4. Dashboard and rollup consistency.
5. Device revoke and device-data deletion semantics.
6. Public profile opt-in and SVG safety.
7. Visual non-blank and readable embed/dashboard states.

Fixture rules:

- Use synthetic fixtures by default.
- Do not commit real user conversations or real API keys.
- Redacted real logs must not contain private content after serialization.
- Add edge cases for malformed/partial files and duplicate/replay data.

## API Notes

Current important routes include:

- `GET /health`
- `POST /v1/auth/device/start`
- `POST /v1/auth/device/authorize` for development authorization
- `POST /v1/auth/device/poll`
- `GET /v1/sync/state`
- `POST /v1/sync/usage-batch`
- `POST /v1/sync/content-batch`
- `GET /v1/dashboard/summary`
- `GET /v1/dashboard/usage-daily`
- `GET /v1/dashboard/breakdowns`
- `GET /v1/sync-runs`
- `GET /v1/devices`
- `DELETE /v1/devices/:id/data`
- `POST /v1/devices/:id/revoke`
- `GET|POST /v1/public-profile`
- `GET /v1/public-profile/:username`
- `GET /v1/badge/:username`
- `GET /v1/embed/:username`
- `GET /v1/leaderboard` currently returns feature-disabled

SVG responses must keep:

- `Content-Type: image/svg+xml; charset=utf-8`
- `X-Content-Type-Options: nosniff`
- CSP that prevents script execution
- CDN-friendly cache headers

## UI Direction

TokSync is an operational developer tool. Keep the UI dense, scan-friendly, and
work-focused. Avoid marketing-heavy layouts inside the app dashboard.

Expected first-class workflows:

- Private dashboard summary and breakdown scanning.
- Device login and device management.
- Source documentation and getting started.
- Sync-run/activity inspection.
- Public profile settings and README embed snippet preview.

Do not add visible explanatory text that describes obvious UI mechanics. Use
clear labels, compact controls, and direct data views.

## Change Discipline

- Prefer existing local patterns over new abstractions.
- No new dependencies without explicit request.
- Keep diffs small and reversible.
- Add tests before cleanup/refactor work when behavior is not already locked.
- Reuse shared schemas, source registry, repository helpers, and renderer helpers.
- Update docs when behavior or contract changes.
- Never echo secrets from `.env` or local config.
- Do not delete `.tmp`, `output`, or broad generated folders unless the task clearly requires it.
- Before committing, follow the Lore commit protocol from the workspace operating contract.

## Completion Checklist

Before reporting done:

- Relevant code or docs are updated.
- Privacy boundaries still hold.
- Existing behavior is not accidentally widened beyond v0.1 scope.
- Targeted tests or checks have run and their results are known.
- Browser/Playwright verification has run for user-visible UI or SVG changes.
- `git status --short` has been checked so the final report can separate your changes from pre-existing work.
