# TokSync Changelog

TokSync 只维护这一份仓库内 changelog。外部文档库的 Update Logs 目录只是镜像副本。

<a id="2026-05-17-private-governance-sync-proof"></a>

## 2026-05-17 - private governance sync proof

日期：2026-05-17

本次更新把 TokSync 从 v0.1 metrics-only 本地闭环推进到 v0.2 私有治理最小闭环：在不放宽内容上传边界的前提下，补齐 user API token/headless sync、Sync Privacy Receipt、Source Health Radar、Merge Copilot、metrics-only export/local viewer，以及更完整的 Web 控制台与验证覆盖。

## 概览

- 增加 user API token 创建、列出、撤销和 `TOKSYNC_API_TOKEN`/`login --token` headless sync 路径。
- 增加 Sync Privacy Receipt、Source Health Radar、Merge Copilot、JSON/CSV export、本地 aggregate viewer 和 submitted public data deletion。
- 强化 metrics-only 隐私校验、workspace label 清洗、unsafe JSON key 拒绝、device-code 消费状态和 API rate limit。
- 扩展 FileTokSyncStore 并发写保护、v0.2 store hydration、Postgres schema/索引草案和同步 receipt/health/merge 数据结构。
- 重做 Web 端导航、首页、dashboard、settings、docs、public profile/embed 展示，并加入 dashboard preview 资产。
- 创建统一 changelog workflow，并同步外部 Update Logs 镜像。

## 用户可见变化

- Web 控制台新增 `/app/receipts`、`/app/health`、`/app/merge` 和更完整的 `/app/exports` 本地查看/导出视图。
- Settings 页面新增 user API token metadata 控制、public submitted data 清理入口，并保留 device revoke/delete 与 public profile 控制。
- Dashboard、activity、devices、sources、models、projects、sync runs、embed、docs、public profile 等页面调整为更密集的 operational UI。
- Landing page 和 README 改为 v0.2 当前状态叙述，展示 preview 资产、quick start、privacy contract 和 roadmap boundaries。

## Agent / Collector

- `apps/agent` 支持 `pnpm agent login --token tsu_...`，并在 sync 时优先使用 `TOKSYNC_API_TOKEN` 做 headless/private metrics 写入。
- dry-run 输出增加 receipt digest 和 excluded field categories，用来证明本地 payload 仍在 metrics-only 边界内。
- collector 增加读取日志、source discovery 测试、unsafe JSON key 拒绝和更严格的 source path segment 推断。
- workspace label 清洗统一复用 `packages/privacy`，避免 collector 自行维护一套规则。

## API / Storage

- API 新增 `/v1/auth/session`、`/v1/sync/receipts`、`/v1/source-health`、`/v1/merge/issues`、`/v1/exports`、`/v1/local/preview`、`/v1/settings/tokens` 和 `/v1/settings/submitted-data`。
- usage ingest 同时支持 device token 与 user API token；写入前执行结构化 metrics-only 检查。
- repository 保存 sync receipts、source health snapshots、merge issues 和 user API token metadata，且 token 明文只在创建响应中返回一次。
- device code 二次 poll 返回 consumed 状态，device code 也会在读写路径中清理过期记录。
- FileTokSyncStore 增加 lock、mtime 检查和原子替换，降低并发写覆盖风险。
- Postgres schema 增加外键、唯一约束、索引、user API token、sync receipt、source health、merge issue 等 v0.2 数据面。

## Privacy / Public Data

- `assertMetricsOnlyPayload` 改为递归检查字段名，并覆盖 prompt/message/response/tool/file/path/diff/patch 等常见泄露键。
- workspace hash 默认依赖显式 workspace secret 或 device pepper；生产环境不允许继续使用默认 secret。
- public profile、badge、embed 仍只读取 public aggregate cache；exports、receipts、merge 和 health 不返回 raw path、workspace hash、source session/message id、device fingerprint 或 token hash。
- submitted public data deletion 会关闭公开资料并清理公开 cache，不删除私有 metrics。

## Web / Embed

- Web API helper 增加 typed response、错误对象、dashboard/source/receipt/merge/device/export 类型。
- 新增 `apps/web/lib/v02.ts`，承载 Source Health、Merge Copilot、Receipt、public graph 和 aggregate CSV 的低敏派生逻辑。
- 新增 `ApiTokenCard`、`LocalDataWorkbench`、`MergeCopilotPanel`、`PrivacyReceiptPanel`、`SourceHealthRadar` 组件。
- embed renderer 使用唯一 paint server id，避免多个 inline SVG 互相冲突。
- Next 配置启用 typed routes、禁用 powered-by header，并按环境开启 standalone output。

## 文档同步

- `README.md` 和 `README.zh-CN.md` 已改写为 v0.2 当前能力、隐私边界、headless sync 和项目文档入口。
- `AGENTS.md` 增加当前功能指南与文档变更清单路径，并提醒 planned differentiators 不得被误写为 v0.1 默认能力。
- 新增 `docs/changelog/CHANGELOG_WORKFLOW.md`，明确统一 changelog、外部镜像、隐私禁区、验证和 Lore commit/push 流程。
- 外部 TokSync docs vault 已包含 v0.2 私有治理、Tokscale 对标、当前功能指南和最新文档变更清单；本次 workflow 只同步 Update Logs 镜像。

## 影响文件

### Apps

- `apps/agent/src/index.ts`
- `apps/api/src/app.ts`
- `apps/api/src/app.test.ts`
- `apps/web/app/**`
- `apps/web/components/**`
- `apps/web/lib/api.ts`
- `apps/web/lib/v02.ts`
- `apps/web/lib/v02.test.ts`
- `apps/web/next.config.mjs`

### Packages

- `packages/collector-core/src/index.ts`
- `packages/collector-core/src/index.test.ts`
- `packages/db/src/**`
- `packages/db/migrations/0001_v0_1_metrics.sql`
- `packages/embed-renderer/src/**`
- `packages/privacy/src/**`
- `packages/pricing/src/index.ts`
- `packages/shared/src/**`

### Docs / Tooling

- `README.md`
- `README.zh-CN.md`
- `AGENTS.md`
- `.gitignore`
- `.prettierignore`
- `docker-compose.yml`
- `scripts/perf-smoke.ts`
- `tests/e2e/toksync.e2e.spec.ts`
- `turbo.json`
- `vitest.config.ts`
- `docs/assets/toksync-dashboard-preview.png`
- `docs/changelog/CHANGELOG.md`
- `docs/changelog/CHANGELOG_WORKFLOW.md`

## 验证

- 已通过：`pnpm exec prettier --check docs/changelog/CHANGELOG.md docs/changelog/CHANGELOG_WORKFLOW.md`
- 已通过：外部 Update Logs 镜像 `Get-FileHash`，仓库内 `CHANGELOG.md` / `CHANGELOG_WORKFLOW.md` 与外部副本哈希一致。
- 已通过：`pnpm test:full`
