# TokSync

[English](./README.md)

TokSync v0.1 是一个面向 AI 编程工具的「仅指标」遥测中心。它会在多台设备之间同步 token、成本、模型、来源、设备和工作区标签等用量指标，但不会上传 prompt、助手回复、工具参数、工具输出、文件内容、密钥或原始项目路径。

当前仓库是一个可本地运行的 v0.1 monorepo。它优先提供快速的本地文件存储开发闭环，同时保留 Postgres schema 和托管部署路径文档，供后续线上版本使用。

## 当前已实现

- 本地 CLI agent，支持 `login`、`logout`、`status`、`sources list`、`sync --dry-run` 和 `sync`。
- 面向 Codex CLI、Claude Code 和 OpenCode 风格用量文件的 TypeScript collector，以及合成测试 fixture。
- Hono API，支持设备登录、设备 token 鉴权、幂等用量写入、dashboard 查询、设备数据删除/吊销和公开资料设置。
- 默认使用 `.tmp/toksync-dev.json` 的文件型开发仓库。
- 面向计划中 Postgres 部署路径的前向 SQL migration。
- Next.js dashboard、设备授权页、文档页、公开资料页、README badge 和 README profile-card 流程。
- 带有 public/private 边界测试的 SVG badge/profile-card renderer。
- Vitest、Playwright E2E、视觉 smoke 测试和性能 smoke 测试覆盖。
- `AGENTS.md`，为后续 coding agent 提供项目专属工作指南。

## v0.1 范围

范围内：

- 仅指标的多设备同步。
- Codex CLI、Claude Code 和 OpenCode source adapter。
- 上传前 dry-run 预览。
- 幂等用量写入和重复同步安全。
- 私有 dashboard 聚合。
- 设备吊销和设备数据删除。
- 公开资料 opt-in。
- GitHub README SVG badge/profile card。

v0.1 范围外：

- 默认会话/内容同步。
- 全文或语义搜索。
- Eval dataset 导出。
- Team workspace、RBAC 或组织报表。
- Leaderboard 实现。
- 计费、订阅、支付集成、套餐限额或计费 UI。

## 架构

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

当前本地存储实现是 `FileTokSyncStore`，可通过 `TOKSYNC_DB_FILE` 控制。`packages/db/migrations/0001_v0_1_metrics.sql` 是当前面向托管 Postgres 的前向 SQL 结构。

## 快速开始

```bash
pnpm install
cp .env.example .env
pnpm db:reset
pnpm db:seed
pnpm dev
```

默认本地服务：

- Web: http://localhost:3000
- API: http://localhost:4000
- Worker health: http://localhost:4100

另开一个终端：

```bash
pnpm agent login --auto-authorize demo
pnpm agent sync --dry-run --fixture ./packages/test-fixtures/codex/basic
pnpm agent sync --fixture ./packages/test-fixtures/codex/basic
```

第一次同步应写入事件。重复执行同一次同步时，应跳过相同事件，而不是重复累计总量。

## 常用命令

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

数据库/开发数据命令：

```bash
pnpm db:reset
pnpm db:seed
pnpm db:migrate
```

Agent 示例：

```bash
pnpm agent status
pnpm agent sources list
pnpm agent logout
TOKSYNC_CONFIG_DIR=.tmp/toksync-agent pnpm agent status
```

## 隐私规则

- 公开资料默认关闭。
- README badge/profile-card endpoint 只能读取公开聚合状态。
- 公开输出不得暴露设备名称、原始项目路径、workspace hash、source session id、message id、message text、工具参数或工具输出。
- 设备指纹不得由硬件标识、hostname、用户名、home path 或项目路径推导。
- 内容同步和 leaderboard 是未来的 opt-in 功能，不是 v0.1 行为。

## 文档

- 项目规格文档：`E:\Project Code\docs\01 - Projects\TokSync`
- Agent 工作指南：`AGENTS.md`
- 当前快速开始和仓库状态：本 README

当外部文档和代码不一致时，把外部文档视为产品意图，把仓库视为当前实现事实。如果变更会影响产品范围、API contract、隐私边界或数据结构，应同步更新两者。
