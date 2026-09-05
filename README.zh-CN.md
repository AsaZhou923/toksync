# TokSync

[English](./README.md)

TokSync 是面向 AI coding 工具的 metrics-only telemetry hub。它跨设备汇总 token、成本估算、模型、来源、设备和 workspace label 等用量指标，但默认不上传 prompt、助手回复、工具参数、工具输出、文件内容、密钥或原始项目路径。

当前仓库是可本地运行的 pnpm/Turbo monorepo。本地开发闭环以 `FileTokSyncStore` 为主；Postgres runtime、Drizzle parity 和 worker queue 仍是 parked/决策项，不是默认运行路径。

## 当前能力

- CLI agent：`login`、`logout`、`status`、`sources list`、`report models/sources/daily/monthly/hourly`、`sync --dry-run`、`sync --yes`，支持 `tsk_` user API token/headless sync，并将本地 `deviceToken` 以 AES-GCM fallback 加密保存。
- Collector：Codex CLI、Claude Code、OpenCode、Cursor usage CSV、GitHub Copilot OTEL JSONL、Gemini CLI tmp chat JSON/JSONL、OpenClaw session/SDK usage logs。
- API：48 个 `/v1` handler 加 `GET /health`，覆盖 GitHub OAuth、设备登录、device token、user API token、幂等 usage ingest、dashboard、Sync Privacy Receipt、Source Health Radar、Merge Copilot 摘要、Cost Guardrails、pricing audit、leaderboard opt-in、metrics JSON/CSV export、Private Usage Vault、Public Proof Pack、Wrapped、device revoke/delete、submitted public data deletion、public profile、SVG badge/profile card/share image，并支持 Redis-backed rate limit。
- Web：一级导航收敛为 Dashboard、Sync、Sources、Share、Settings；旧登录后 app URL 通过兼容跳转进入新任务中心，公开 `/leaderboard`、public API 和 SVG URL 继续保留，并继续启用 CSP/安全响应头。
- Storage：本地默认 `FileTokSyncStore`；hosted SQL shape 已包含 `vault_exports` ledger。设置 `TOKSYNC_VAULT_ARTIFACT_DIR` 后，vault artifact 可写入私有对象目录，ledger 只保存 storage key 和 digest。
- 测试：Vitest、Playwright E2E、visual smoke、perf smoke、Turbo typecheck/lint/build。

## 快速开始

最新审查与修复：[2026-09-05 更新记录](docs/changelog/CHANGELOG.md#2026-09-05-review-and-reliability-hardening)。

连接 agent、预览 metrics-only payload，然后同步：

```bash
toksync login
toksync sync --dry-run
toksync sync
```

上传前会先显示 event 数、token、成本估算、source、日期范围和 privacy receipt。
交互式 device login 会要求确认；同步成功后会输出 Dashboard URL。

## 开发者设置

```bash
pnpm install
cp .env.example .env
pnpm db:reset
pnpm db:seed
pnpm dev
```

`pnpm dev` 只启动 Web 和 API。需要 worker 进程时，单独运行：

```bash
pnpm dev:worker
```

本地 browser/dev auth 需要显式开启：保留 `.env` 中的
`TOKSYNC_DEV_AUTH=1`，`--auto-authorize demo` 和基于
`X-TokSync-User` 的本地 Web 请求才会生效。hosted/prod-like 验证请不设置
或设为 `0`。设备码默认 900 秒过期，可用 `DEVICE_CODE_TTL_SECONDS` 调整。

另开一个终端：

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

重复同步同一批事件时，TokSync 应该把重复事件计入 `skipped`，而不是重复累计 totals。

Hosted 或 private headless sync 需要配置真实 API endpoint，并使用 user API token：

```bash
TOKSYNC_API_URL=https://your-toksync-api.example.com \
pnpm agent login --token tsk_...
TOKSYNC_API_URL=https://your-toksync-api.example.com \
TOKSYNC_API_TOKEN=tsk_... \
pnpm agent sync --yes
```

`TOKSYNC_API_TOKEN` 只作为当前进程一次性输入，读取后会从 agent 进程环境中清除。设备登录写入本地配置时，`deviceToken` 会保存为 `deviceTokenEncrypted`，使用 AES-256-GCM 和本机 `config.key`；旧的明文配置仍可读取，并会在下次保存时迁移。device token 在非交互环境上传时必须显式传入 `--yes`；user API token 是明确的 headless 路径。

无需打开 Web dashboard 也可以查看本地报表：

```bash
pnpm agent report models --fixture ./packages/test-fixtures/codex/basic
pnpm agent report daily --fixture ./packages/test-fixtures/codex/basic --format json
```

默认本地服务：

| Service | URL                   |
| ------- | --------------------- |
| Web     | http://localhost:3000 |
| API     | http://localhost:4000 |
| Worker  | http://localhost:4100 |

Worker 地址只在运行 `pnpm dev:worker` 后可用。根目录 `pnpm dev` 只启动 Web 和 API。

## 隐私边界

- Public profile 默认关闭。
- README badge/profile-card、Public Proof Pack 和 public Wrapped endpoint 只读取 public aggregate cache 或 receipt digest。
- Public output 不得暴露设备名、原始路径、workspace hash、source session id、message id、message text、工具参数或工具输出。
- workspace/project label 默认私有，只有用户显式允许后才可进入公开输出。
- Receipt、Merge、Health、Export、Guardrails、Vault 使用低敏字段类别和聚合摘要，不返回 prompt、assistant reply、tool args、tool output、file content、raw path、source session id、source message id 或 workspace hash。
- 设备指纹不得由 hostname、硬件标识、用户名、home path 或项目路径推导。
- cost 是估算，不是 provider billing truth。
- Cost Guardrails 只属于私有 dashboard，不进入 public profile、README SVG 或 leaderboard。
- leaderboard 需要先开启 public profile，再单独 opt-in，并且只读取 public aggregate cache；排行榜范围只做全局榜。
- Private Usage Vault 使用至少 16 字符的用户 recovery passphrase 加密 metrics-only artifact，新导出记录显式 scrypt 参数，支持下载、preview 和跨实例 import；不导出正文或工具 payload。
- 多实例 hosted 部署前可配置 `TOKSYNC_RATE_LIMIT_REDIS_URL=redis://...` 或 `rediss://...`，让 API rate limit 共享 Redis 计数；未配置时仍使用本地内存限流。
- content sync、search 和 eval export 仍是后续 opt-in 能力。

## v0.6 范围

当前主线已经进入简化验收：默认 app 路径是 Dashboard、Sync、Sources、Share、Settings。S6 API/repository 收敛已有审计结论但不做无证据删除；S7 Postgres/worker hosted 决策仍单独立项，不随 UI 简化同时执行。

| 能力                           | 当前状态       | 边界                                                                                                                                                                 |
| ------------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public label privacy           | 已实现         | project/workspace label 默认私有，显式开启后只展示安全 label                                                                                                         |
| Merge Copilot                  | 已实现最小闭环 | 解释 duplicate/replay，不展示原始消息标识                                                                                                                            |
| Sync Privacy Receipt           | 已实现最小闭环 | digest、安全字段类别、排除类别                                                                                                                                       |
| Source Health Radar            | 已实现最小闭环 | 私有 source 覆盖、最近同步、缺失和保留期风险                                                                                                                         |
| GitHub OAuth                   | 已实现第一版   | 首个生产 browser login 路径；email magic link 后置                                                                                                                   |
| User API token                 | 已实现最小闭环 | 创建/列出/撤销 metadata，明文 token 只在创建响应返回一次                                                                                                             |
| Metrics export/local viewer    | 已实现最小闭环 | JSON/CSV 只导出安全 metrics 列                                                                                                                                       |
| Submitted public data deletion | 已实现最小闭环 | 清理公开 cache，不删除私有 raw metrics                                                                                                                               |
| Cost Guardrails                | 已实现第一版   | 私有预算阈值、cost spike、unknown pricing、budget exceeded                                                                                                           |
| Leaderboard                    | 已实现第一版   | public profile + 单独 opt-in，只读取公开聚合 cache；全局榜 only                                                                                                      |
| Source parity                  | 已实现第一版   | Cursor CSV、Copilot OTEL、Gemini tmp chats、OpenClaw usage logs；仍保持 metrics-only                                                                                 |
| Private Usage Vault            | 已实现第一版   | passphrase 加密导出、artifact 下载/存储、import preview、幂等恢复；hosted ledger SQL 已补齐                                                                          |
| Phase 0 稳定化门禁             | 已实现         | FileStore repository mutation transaction、parser/component 测试、Agent token 加密、Redis rate limit 开关和 vault 版本不兼容回归                                     |
| Public Proof Pack              | 已实现第一版   | `/v1/public-proof/:username` 只读 public aggregate、public-safe daily 和 receipt digest；旧 `/app/proof-pack` 兼容跳转到 `/app/share?tab=proof`                      |
| Wrapped                        | 已实现第一版   | `/v1/wrapped` 私有 summary；`/v1/wrapped/:username` 公开低敏卡片只读 public cache；旧 `/app/wrapped` 兼容跳转到 `/app/share?tab=wrapped`                             |
| CLI reports                    | 已实现第一版   | `report` 支持 models、sources、daily、monthly、hourly、table/json 和 source filter，不输出 raw path 或消息标识                                                       |
| Public profile/share           | 已实现第一版   | 公开 profile 有 activity graph、section tabs、owner controls、badge/card/share SVG；主要登录后入口为 `/app/share`，操作模型是开关、Save、Copy；全部只读 public cache |
| Leaderboard UX                 | 已实现第一版   | 公开 `/leaderboard` 支持 period、search、tokens/cost/active days/streak 排序和当前用户排名；旧 `/app/leaderboard` 兼容跳转到 `/app/share?tab=leaderboard`            |
| Settings/pricing UX            | 已实现第一版   | settings 展示 account 状态、copy-once token、last-used/revoke metadata、删除前导出提示；models 页展示 pricing audit/unknown queue                                    |

仍不属于当前范围：email magic link、billing/订阅/支付、content sync、全文/语义搜索、eval dataset export、团队版、leaderboard 的 source/model 分榜、全局榜 cursor 分页增强、duplicate_cost_jump 异常解释。

## 常用命令

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

日常验证请使用根目录 Playwright wrapper：`pnpm test:e2e`、
`pnpm test:e2e:hosted` 和 `pnpm test:visual`。它们会为每次运行分配隔离的
API/Web 端口、JSON store、agent config、Next output 和 Playwright output。
除非手动为每次运行设置独立的 `TOKSYNC_PLAYWRIGHT_*` 路径与端口，否则不支持
直接并发运行 `playwright test`。

数据库/开发数据：

```bash
pnpm db:reset
pnpm db:seed
pnpm db:migrate
```

Agent 示例：

```bash
pnpm agent status
pnpm agent sources list
pnpm agent report models --fixture ./packages/test-fixtures/codex/basic
pnpm agent report hourly --fixture ./packages/test-fixtures/codex/basic --source codex --format table
pnpm agent logout
TOKSYNC_CONFIG_DIR=.tmp/toksync-agent pnpm agent status
```

## 项目文档

- 产品规格：`E:\Project Code\docs\01 - Projects\TokSync`
- 当前功能指南：`E:\Project Code\docs\01 - Projects\TokSync\03 - Guides\当前功能与使用指南.md`
- 最新文档变更清单：`E:\Project Code\docs\01 - Projects\TokSync\01 - Product\TokSync 文档变更清单.md`
- Agent 指南：`AGENTS.md`

当外部文档和代码不一致时，把外部文档视为产品意图，把仓库视为当前实现事实。变更产品范围、API contract、隐私边界或数据结构时，需要同步更新两者。
