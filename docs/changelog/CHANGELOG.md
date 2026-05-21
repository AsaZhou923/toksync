# TokSync Changelog

TokSync 只维护这一份仓库内 changelog。外部文档库的 Update Logs 目录只是镜像副本。

<a id="2026-05-20-v0-4-source-parity-vault"></a>

## 2026-05-20 - v0.4 source parity and private vault

日期：2026-05-20

本次更新完成 v0.4 第一版：扩展 Tokscale-adjacent source registry，新增 Private Usage Vault 的 passphrase 加密导出、artifact 取回、import preview 和幂等恢复闭环，并同步仓库 README 与外部 specs。

## 概览

- Source registry 新增 Cursor、GitHub Copilot、Gemini CLI 和 OpenClaw，collector 支持 Cursor usage CSV、Copilot OTEL JSONL、Gemini tmp chats 和 OpenClaw sessions/transcript/SDK usage 真实格式。
- 未知 pricing 的 model 不再被估算为准确成本，Gemini model 归属到 `google` provider。
- 新增 `/app/vault` 和 dashboard/docs 入口，提供 vault ledger、artifact 下载、import preview 和 restore controls。
- 新增 `GET /v1/vault/exports`、`POST /v1/vault/exports`、`GET /v1/vault/exports/:id`、`POST /v1/vault/imports/preview` 和 `POST /v1/vault/imports`。
- Vault artifact 使用用户 recovery passphrase 派生密钥加密，preview 不写库，import 只插入当前用户缺失的 metrics events 并跳过重复事件。
- Playwright E2E/visual runner 改为显式管理 API/Web 服务生命周期，避免连续运行 full gate 时 3300/4300 端口残留。

## 隐私 / 边界

- Vault 仍是 metrics-only：不导出 prompt、assistant reply、tool args、tool output、file content、raw path、plaintext token 或 secrets。
- `includeContent` 保持关闭，内容同步、搜索、eval export 和 Public Proof Pack 仍为后续 opt-in 能力。
- Source parity 第一版已前滚为四个真实格式适配；真实工具格式漂移 fixture 和 pricing refresh 继续作为后续加固项。

## 影响文件

### Apps

- `apps/api/src/app.ts`
- `apps/api/src/app.test.ts`
- `apps/web/app/app/page.tsx`
- `apps/web/app/app/sources/page.tsx`
- `apps/web/app/app/exports/page.tsx`
- `apps/web/app/app/vault/page.tsx`
- `apps/web/app/docs/page.tsx`
- `apps/web/app/docs/sources/page.tsx`
- `apps/web/components/VaultConsole.tsx`
- `apps/web/lib/api.ts`
- `apps/web/lib/v02.ts`
- `apps/web/lib/v02.test.ts`
- `apps/web/lib/vault-ui.ts`

### Packages

- `packages/shared/src/schemas.ts`
- `packages/shared/src/schemas.test.ts`
- `packages/shared/src/source-registry.ts`
- `packages/collector-core/src/index.ts`
- `packages/collector-core/src/index.test.ts`
- `packages/db/src/repository.ts`
- `packages/db/src/repository.test.ts`
- `packages/db/src/schema.ts`
- `packages/db/src/store.ts`
- `packages/db/src/types.ts`
- `packages/db/src/vault-postgres.ts`
- `packages/db/migrations/0001_v0_1_metrics.sql`
- `tests/visual/embed.visual.spec.ts`
- `package.json`
- `playwright.config.ts`
- `scripts/run-playwright.mjs`
- `scripts/playwright-web-server.mjs`

### Docs

- `README.md`
- `README.zh-CN.md`
- `docs/changelog/CHANGELOG.md`
- `E:\Project Code\docs\01 - Projects\TokSync\TokSync.md`
- `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\overview.md`
- `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\prd.md`
- `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\architecture.md`
- `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\api-design.md`
- `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\database-design.md`
- `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\sitemap.md`
- `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\testing.md`
- `E:\Project Code\docs\01 - Projects\TokSync\01 - Product\TokSync 文档变更清单.md`
- `E:\Project Code\docs\01 - Projects\TokSync\03 - Guides\当前功能与使用指南.md`
- `E:\Project Code\docs\01 - Projects\TokSync\09 - Changelog\Update Logs\CHANGELOG.md`

## 验证

- `pnpm exec vitest run packages/shared/src/schemas.test.ts packages/db/src/repository.test.ts apps/api/src/app.test.ts apps/web/lib/v02.test.ts`
- `pnpm typecheck`
- `pnpm test:e2e`
- `pnpm test:visual`
- `pnpm test:full`
- drift scan for stale `generic metrics`, `通用 JSON`, old Postgres vault migration wording, and obsolete `tsu_` contract language

<a id="2026-05-19-hosted-auth-public-boundary-alignment"></a>

## 2026-05-19 - hosted auth public boundary alignment

日期：2026-05-19

本次更新把 2026-05-19 外部 specs 中已经收口的产品决策落到仓库实现：生产登录走 GitHub OAuth browser session，user API token 前缀回到文档约定的 `tsk_`，公开 workspace/project label 只有显式开启后才展示，并且 leaderboard 保持 global-only、public-cache-only 的边界。

## 概览

- 增加 GitHub OAuth start/callback/logout/session cookie 路径，生产态不再依赖开发用 `X-TokSync-User` header。
- 将 user API token 创建、鉴权、测试和 README 示例统一为 `tsk_` 前缀，匹配 auth spec。
- 增加 public profile 的 `showWorkspaceBreakdown` 开关、公开安全 label 聚合和存储 hydration，默认不公开 project/workspace label。
- 明确 leaderboard 第一版只做全局榜，对 `source`、`model`、`modelId`、`cursor` 查询参数返回 `400 unsupported_query`。
- 同步 README 中的 hosted-first、GitHub OAuth、global-only leaderboard、公开 label 隐私边界。

## 用户可见变化

- Login 页面提供 “Continue with GitHub” 入口，同时保留开发态 demo 入口。
- Settings/public profile 表单新增 “Show project labels” 开关；公开 profile 页面只有开关开启时才展示安全项目 label breakdown。
- Dashboard、Embed、Exports、Leaderboard 页面同步识别 `showWorkspaceBreakdown`，避免老数据或 API 降级时缺字段。
- README/中文 README 的 headless sync 示例改为 `tsk_` token。

## API / Storage

- `GET /v1/auth/github/start`、`GET /v1/auth/github/callback`、`POST /v1/auth/logout` 和 `GET /v1/auth/session` 形成 GitHub OAuth session 路径；OAuth state 和 session cookie 使用 HMAC 签名校验。
- `createApiApp` 支持显式 `sessionSecret` 和 GitHub OAuth 配置，生产态要求配置 session secret。
- 私有 API 在 `devAuth: false` 时读取 session cookie，不再信任开发 header。
- `users`、`profile_stats`、`public_profile_stats` 和对应 TypeScript 类型增加 workspace breakdown 字段；file store hydration 为旧数据补默认值。
- user API token 创建和鉴权统一使用 `tsk_` 前缀，旧 `tsu_` 不再作为当前契约接受。

## Web / Embed

- Public profile settings、公开 profile 页面和 embed/dashboard 相关类型新增 `showWorkspaceBreakdown`。
- Embed renderer 的 public stats 类型增加 `topWorkspaces` 和 `showWorkspaceBreakdown`，供公开 profile/card 数据边界使用。
- Login 页面文案改为 hosted GitHub OAuth first，demo 仅作为开发路径。

## Privacy / Public Data

- Workspace/project label 默认私有；即使开启公开开关，也只展示经过清洗、且不含 path separator 或 drive separator 的安全 label。
- Public profile 默认返回空 `topWorkspaces`；开启 `showWorkspaceBreakdown` 后也不会返回 workspace hash 或 raw path。
- Leaderboard 仍不展示 device id、workspace label/hash、source session id 或 source message id，并拒绝 source/model 分榜和 cursor 查询。
- Billing、content sync、Private Usage Vault、source/model leaderboard 分榜和 cursor 分页仍未进入当前实现。

## 文档同步

- `README.md` 和 `README.zh-CN.md` 同步 hosted-first、GitHub OAuth、`tsk_` token、global-only leaderboard 和公开 label 边界。
- `docs/changelog/CHANGELOG.md` 修正历史 v0.2 条目中的 user API token 示例前缀。
- 外部 TokSync specs 已包含 2026-05-19 产品决策和相关 API/data-shape 说明；本次 workflow 继续同步 Update Logs 镜像。

## 影响文件

### Apps

- `apps/api/src/app.ts`
- `apps/api/src/app.test.ts`
- `apps/web/app/login/page.tsx`
- `apps/web/app/app/page.tsx`
- `apps/web/app/app/embed/page.tsx`
- `apps/web/app/app/exports/page.tsx`
- `apps/web/app/app/settings/page.tsx`
- `apps/web/app/app/leaderboard/page.tsx`
- `apps/web/app/u/[username]/page.tsx`
- `apps/web/components/PublicProfileForm.tsx`
- `apps/web/lib/api.ts`

### Packages

- `packages/shared/src/errors.ts`
- `packages/shared/src/schemas.ts`
- `packages/db/src/repository.ts`
- `packages/db/src/repository.test.ts`
- `packages/db/src/schema.ts`
- `packages/db/src/store.ts`
- `packages/db/src/types.ts`
- `packages/db/src/scripts/seed.ts`
- `packages/db/migrations/0001_v0_1_metrics.sql`
- `packages/embed-renderer/src/index.ts`

### Docs

- `README.md`
- `README.zh-CN.md`
- `docs/changelog/CHANGELOG.md`

## 验证

- 已通过：`pnpm test -- apps/api/src/app.test.ts packages/db/src/repository.test.ts`
- 已通过：`pnpm format:check`
- 已通过：`pnpm test:full`
- 已通过：`pnpm exec prettier --check docs/changelog/CHANGELOG.md docs/changelog/CHANGELOG_WORKFLOW.md`
- 已通过：外部 Update Logs 镜像 SHA256 parity
- 已通过：`rg -n "docs/changelog/update-log|update-log-[0-9]{4}|CHANGELOG.md#" . -g "!docs/changelog/CHANGELOG_WORKFLOW.md" -g "!docs/changelog/CHANGELOG.md"` 无残留匹配
- 已通过：`git diff --check`

<a id="2026-05-18-v0-3-cost-guardrails-leaderboard"></a>

## 2026-05-18 - v0.3 cost guardrails leaderboard

日期：2026-05-18

本次更新完成 TokSync v0.3 第一版：把私有 Cost Guardrails 和 opt-in Leaderboard 纳入当前实现，同时修复全量验证与代码评审发现的成本守卫边界问题，并把仓库文档和外部 specs 收敛到“v0.3 只包含成本治理和公开榜单第一版”的真实范围。

## 概览

- 新增私有 Cost Guardrails API、repository 语义、schema 草案和 Web 控制台入口，支持 global/source/model/device 预算规则、budget exceeded、cost spike 和 unknown pricing 异常。
- 新增 `/app/guardrails` 与 `/app/budgets` 成本治理页面，并在 dashboard 中展示私有成本守卫概览。
- 新增 opt-in Leaderboard API 与 `/app/leaderboard` 页面，要求先开启 public profile，再单独加入榜单，并且只读取 `public_profile_stats` 公开聚合 cache。
- 修复代码评审发现的 scoped cost guardrail 日期窗口、anomaly 时间戳稳定性和 device target 归属校验问题。
- 移除当前 v0.3 migration/schema 中未使用的 leaderboard snapshot 表，把 snapshot worker、Private Usage Vault、Source 扩展机制继续保留为后续阶段。

## 用户可见变化

- Dashboard 导航新增 Guardrails 和 Leaderboard 入口；Guardrails 标记为 v0.3，Leaderboard 标记为 opt-in。
- Guardrails 页面可以配置所有私有用量、source、model 或 device 维度的预算阈值，并查看私有异常摘要。
- Budgets 页面作为成本治理入口复用 Guardrails 控制台，避免出现空页面或未接线入口。
- Leaderboard 页面提供 participation gate、公开边界说明、metric/period 切换和当前公开聚合榜单预览。

## API / Storage

- `GET /v1/cost-guardrails` 和 `POST /v1/cost-guardrails` 需要私有 user session；预算规则和 anomalies 不进入 public profile、README SVG 或 leaderboard 输出。
- `POST /v1/leaderboard/opt-in` 会在 public profile 未开启时拒绝加入榜单；`GET /v1/leaderboard` 只返回已公开且已 opt-in 的用户。
- Cost Guardrails 的 source/model/device 规则按自身 scope 的最新事件日期计算窗口，不会被其他 source 或 device 的新事件推走。
- Cost anomaly 以稳定 id upsert，并保留首次 `createdAt` 和 `status`，避免读接口刷新时破坏审计语义。
- Device-scoped guardrail 现在要求 UUID，并校验 target device 属于当前用户；非法 target 不会写入 file store 或未来 SQL 外键不接受的状态。

## Web / Embed

- 新增 `CostGuardrailsConsole`、`CostGuardrailsPanel` 和 `LeaderboardConsole` 组件。
- Web API helper 增加 Cost Guardrails、Leaderboard 和 public profile opt-in 类型。
- UI 文案统一为“连接的 API 未暴露 v0.3 合同”类降级提示，避免把当前已实现能力描述成未上线。

## Privacy / Public Data

- Cost Guardrails 保持私有 dashboard 能力，不读取公开缓存，也不把预算、device、workspace、source session 或 message 级信息写入公开输出。
- Leaderboard 只读公开聚合 cache；API 测试断言不会泄露 device id、workspace label/hash、source session id 或 source message id。
- Private Usage Vault、Public Proof Pack、content sync、billing、source/model 分榜和 cursor 分页仍为后续能力，不在 v0.3 当前实现中打开。

## 文档同步

- `README.md`、`README.zh-CN.md` 和 `AGENTS.md` 更新为 v0.3 当前能力与边界。
- 外部 specs 同步更新 overview、prd、architecture、api-design、database-design、sitemap 和 testing，明确 Vault、snapshot worker、Source 扩展机制仍在后续阶段。
- Changelog workflow 的外部 Update Logs 镜像已按统一 `CHANGELOG.md` / `CHANGELOG_WORKFLOW.md` 结构同步。

## 影响文件

### Apps

- `apps/api/src/app.ts`
- `apps/api/src/app.test.ts`
- `apps/web/app/app/page.tsx`
- `apps/web/app/app/budgets/page.tsx`
- `apps/web/app/app/guardrails/page.tsx`
- `apps/web/app/app/leaderboard/page.tsx`
- `apps/web/app/layout.tsx`
- `apps/web/app/globals.css`
- `apps/web/components/CostGuardrailsConsole.tsx`
- `apps/web/components/CostGuardrailsPanel.tsx`
- `apps/web/components/LeaderboardConsole.tsx`
- `apps/web/lib/api.ts`

### Packages

- `packages/shared/src/schemas.ts`
- `packages/db/src/repository.ts`
- `packages/db/src/repository.test.ts`
- `packages/db/src/schema.ts`
- `packages/db/src/store.ts`
- `packages/db/src/types.ts`
- `packages/db/migrations/0001_v0_1_metrics.sql`

### Docs

- `README.md`
- `README.zh-CN.md`
- `AGENTS.md`
- `docs/changelog/CHANGELOG.md`
- 外部 TokSync specs 中的 v0.3 范围、API、数据库、站点地图和测试策略说明

## 验证

- 已通过：`pnpm exec vitest run packages/db/src/repository.test.ts apps/api/src/app.test.ts`
- 已通过：`pnpm typecheck`
- 已通过：`pnpm exec prettier --check README.md README.zh-CN.md AGENTS.md "E:/Project Code/docs/01 - Projects/TokSync/00 - Specs/*.md"`
- 已通过：`pnpm test:full`
- 已通过：浏览器 spot check，`/app/guardrails`、`/app/budgets`、`/app/leaderboard` 实际渲染正常且 console 无 error。
- 已通过：外部 Update Logs 镜像 `Get-FileHash`，仓库内 `CHANGELOG.md` / `CHANGELOG_WORKFLOW.md` 与外部副本哈希一致。

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

- `apps/agent` 支持 `pnpm agent login --token tsk_...`，并在 sync 时优先使用 `TOKSYNC_API_TOKEN` 做 headless/private metrics 写入。
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
