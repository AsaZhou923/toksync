# TokSync Changelog

TokSync 只维护这一份仓库内 changelog。外部文档库的 Update Logs 目录只是镜像副本。

<a id="2026-05-22-v0-5-hardening-follow-up"></a>

## 2026-05-22 - v0.5 hardening follow-up

日期：2026-05-22

本次更新收口 v0.5 深度审查后的生产化与可维护性问题：让本地开发认证改为显式开关，给 agent 本地 token 增加 AES-GCM fallback 加密，把 API rate limit / Vault / collector / repository 的高风险职责拆到更清晰的边界，并用回归测试锁住这些行为。Public Proof Pack、Wrapped、leaderboard、README SVG 等公开面仍只读取低敏 public aggregate 或 receipt digest，不扩大 metrics-only 边界。

## 概览

- 本地 browser/dev auth 默认关闭，仅在 `TOKSYNC_DEV_AUTH=1` 或测试显式传入 `devAuth: true` 时信任 `X-TokSync-User` / `TOKSYNC_DEV_USER`。
- Agent config 写入 `deviceTokenEncrypted`，使用 AES-256-GCM 与本机 `config.key`；旧明文 config 仍可读取并在下一次保存时迁移。
- API 新增全局 JSON error handler、共享认证 middleware、可配置 `DEVICE_CODE_TTL_SECONDS` 和 Redis-backed rate limit 开关。
- Private Usage Vault routes 拆到 `apps/api/src/routes/vault.ts`，Vault artifact/encryption/import helpers 拆到 `packages/db/src/vault.ts`。
- Collector 共享 parser helper、candidate normalization 和 Cursor CSV parser 独立出来，generic dedup key 统一包含 `modelId` 并扩展 provider inference。
- FileStore mutation 改走锁内 transaction reread，避免 stale reader 覆盖并发写入。

## Agent / Collector

- `TOKSYNC_API_TOKEN` 作为一次性进程输入读取后清出当前 agent 进程环境。
- `apps/agent/src/config.test.ts` 覆盖 encrypted token 保存与 legacy plaintext migration。
- `discoverSources()` 支持注入 env/home/listUsageFiles，便于测试 Codex/Copilot discovery 而不依赖真实用户目录。
- `packages/collector-core/src/source-parsers/candidate.ts` 统一 metrics candidate 转 `UsageEventV1`，继续过滤 raw workspace path。
- `packages/collector-core/src/source-parsers/cursor.ts` 负责 Cursor usage CSV 解析，保持 metrics-only 输出。

## API / Storage

- `AUTH_REQUIRED_ROUTES` + `authMiddleware()` 替代私有路由内重复的 session/header 判断。
- `app.onError()` 把未捕获异常稳定成 `internal_error` JSON，避免 Hono 默认错误文本泄露到客户端。
- `apps/api/src/rate-limit.ts` 默认使用内存 store；设置 `TOKSYNC_RATE_LIMIT_REDIS_URL=redis://...` 或 `rediss://...` 后启用 Redis store。
- `apps/api/src/index.ts` 会读取 repo root `.env`，让本地 `pnpm dev` 和 Playwright flow 共享同一套 dev auth / TTL 配置。
- `TokSyncRepository` 的持久化 mutation 统一通过 FileStore transaction 执行，新增 stale reader 合并和 repository mutation transaction 回归。
- Vault export/import 的 artifact store、scrypt/AES-GCM、snapshot parse、device recovery 和 view 映射移入 `packages/db/src/vault.ts`。

## Web / Security

- Web CSP `connect-src` 移除裸 `https:`，只保留 self、配置 API origin 和 localhost API。
- Vitest 覆盖 TSX app/page 与 console components，确保 dashboard、Vault、Proof Pack、Wrapped 和 token controls 的关键文本与隐私断言可回归。

## Privacy / Public Data

- Public profile、badge/card、leaderboard、Public Proof Pack 和 public Wrapped 不读取 private raw events。
- Agent config 加密只保护本地 device token；它不改变 sync payload，payload 仍保持 metrics-only。
- Redis rate limit 只保存计数键，不保存 prompt、assistant reply、tool payload、file content 或原始项目路径。

## 文档同步

- `README.md`、`README.zh-CN.md` 已同步 dev auth、device code TTL、agent token encryption、Redis-backed rate limit 和 stabilization gate 状态。
- 外部 `api-design.md`、`auth-and-permission.md`、`local-development.md`、`testing.md`、当前功能指南与 v0.5 审查报告已对齐当前实现。
- 外部 Update Logs 镜像需继续保持与本 changelog 一致。

## 影响文件

### Apps

- `.env.example`
- `.gitignore`
- `.prettierignore`
- `apps/agent/src/config.ts`
- `apps/agent/src/config.test.ts`
- `apps/agent/src/index.ts`
- `apps/agent/src/index.test.ts`
- `apps/api/src/app.ts`
- `apps/api/src/app.test.ts`
- `apps/api/src/index.ts`
- `apps/api/src/rate-limit.ts`
- `apps/api/src/rate-limit.test.ts`
- `apps/api/src/routes/vault.ts`
- `apps/web/app/app/page.test.tsx`
- `apps/web/components/console-components.test.tsx`
- `apps/web/next.config.mjs`
- `apps/web/next.config.test.ts`

### Packages / Scripts

- `packages/collector-core/src/index.ts`
- `packages/collector-core/src/index.test.ts`
- `packages/collector-core/src/source-parsers.ts`
- `packages/collector-core/src/source-parsers/shared.ts`
- `packages/collector-core/src/source-parsers/candidate.ts`
- `packages/collector-core/src/source-parsers/cursor.ts`
- `packages/db/src/index.ts`
- `packages/db/src/repository.ts`
- `packages/db/src/repository.test.ts`
- `packages/db/src/store.ts`
- `packages/db/src/vault.ts`
- `packages/db/src/vault-postgres.ts`
- `packages/shared/src/errors.ts`
- `scripts/perf-smoke.ts`
- `scripts/run-playwright.mjs`
- `vitest.config.ts`

### Docs

- `README.md`
- `README.zh-CN.md`
- `docs/changelog/CHANGELOG.md`
- `docs/changelog/CHANGELOG_WORKFLOW.md` external mirror
- `E:\Project Code\docs\01 - Projects\TokSync\01 - Product\TokSync 文档变更清单.md`

## 验证

- `pnpm exec prettier --check docs/changelog/CHANGELOG.md docs/changelog/CHANGELOG_WORKFLOW.md "E:/Project Code/docs/01 - Projects/TokSync/01 - Product/TokSync 文档变更清单.md"`
- 外部 Update Logs `CHANGELOG.md` / `CHANGELOG_WORKFLOW.md` 与仓库内版本 SHA256 一致。
- `pnpm agent sync --dry-run --fixture ./packages/test-fixtures/codex/basic`
- `pnpm test apps/agent/src/index.test.ts`
- `pnpm test:full`

<a id="2026-05-22-v0-5-proof-wrapped-web-console"></a>

## 2026-05-22 - v0.5 proof and wrapped web console

日期：2026-05-22

本次更新把 v0.5 从 Public Proof Pack / Wrapped API 前置闸门推进到可见产品面：Web 控制台新增 Proof Pack 和 Wrapped 页面，导航、首页、docs、E2E/visual smoke 与外部文档同步到 v0.5 当前状态。内容同步、搜索和 eval export 仍保持后置 opt-in，不在本次范围内打开。

## 概览

- 新增 `/app/proof-pack`，展示 public profile 状态、proof digest、公开字段、排除字段和 receipt digest ledger。
- 新增 `/app/wrapped`，展示私有 Wrapped summary、公开 Wrapped card 状态和 public endpoint。
- Share 导航、dashboard public surface、docs 和首页增加 Proof Pack / Wrapped 入口，并把旧 v0.1/v0.4 阶段文案更新到 v0.5。
- Public Proof Pack / Wrapped Web 页面只消费 `/v1/public-proof/:username`、`/v1/wrapped`、`/v1/wrapped/:username` 和 public profile 设置，不直接读取 private raw events。
- Web server API helper 会转发浏览器 session cookie；Proof Pack / Wrapped 页面用 `/v1/auth/session` 的真实用户名生成 public endpoint，避免 hosted OAuth 场景误读 dev user。

## 测试与验证

- Web typecheck 已覆盖新增页面和 API 类型。
- Playwright E2E 新增 `/app/proof-pack`、`/app/wrapped` 可见性、public profile disabled 和公开字段 toggle-off 断言。
- Playwright visual smoke 新增 Proof Pack / Wrapped 非空视觉状态断言。

## 文档同步

- `README.md`、`README.zh-CN.md`、`AGENTS.md`、外部 overview、PRD、architecture、sitemap、当前功能指南、TokSync 入口文档、对标计划和文档变更清单已同步 v0.5 Web 控制台状态。
- 外部 Update Logs 镜像需继续保持与本 changelog 一致。

## 影响文件

### Apps

- `apps/web/app/app/proof-pack/page.tsx`
- `apps/web/app/app/wrapped/page.tsx`
- `apps/web/app/app/page.tsx`
- `apps/web/app/docs/embed/page.tsx`
- `apps/web/app/docs/getting-started/page.tsx`
- `apps/web/app/docs/page.tsx`
- `apps/web/app/layout.tsx`
- `apps/web/app/page.tsx`
- `apps/web/app/privacy/page.tsx`
- `apps/web/app/terms/page.tsx`
- `apps/web/lib/api.ts`

### Tests

- `tests/e2e/toksync.e2e.spec.ts`
- `tests/visual/embed.visual.spec.ts`

### Docs

- `AGENTS.md`
- `README.md`
- `README.zh-CN.md`
- `docs/changelog/CHANGELOG.md`
- `E:\Project Code\docs\01 - Projects\TokSync\TokSync.md`
- `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\overview.md`
- `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\prd.md`
- `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\architecture.md`
- `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\sitemap.md`
- `E:\Project Code\docs\01 - Projects\TokSync\01 - Product\TokSync Tokscale 对标调研与前端页面设计计划.md`
- `E:\Project Code\docs\01 - Projects\TokSync\01 - Product\TokSync 文档变更清单.md`
- `E:\Project Code\docs\01 - Projects\TokSync\02 - Architecture\TokSync 技术架构文档.md`
- `E:\Project Code\docs\01 - Projects\TokSync\03 - Guides\当前功能与使用指南.md`
- `E:\Project Code\docs\01 - Projects\TokSync\05 - Reviews\TokSync v0.4 后续架构建议评估报告.md`
- `E:\Project Code\docs\01 - Projects\TokSync\09 - Changelog\Update Logs\CHANGELOG.md`

<a id="2026-05-22-phase0-phase1-public-proof"></a>

## 2026-05-22 - phase 0/1 public proof gate

日期：2026-05-22

本次更新完成 v0.4 后续架构建议报告中的 Phase 0 和 Phase 1：用可复用合同测试锁住 FileStore 当前 ingestion/rollup 语义，补齐 Gemini/OpenClaw parser、FileStore 锁竞争和 Vault 版本不兼容回归；同时落地 Public Proof Pack 与 Wrapped API/Web 第一版，确保公开证明只读 public aggregate、public-safe daily 和 receipt digest。

## 概览

- 新增 `GET /v1/public-proof/:username`，返回 `proofDigest`、公开字段列表、排除字段列表、公开 aggregate summary、public-safe daily 和 receipt digest 列表。
- 新增 `GET /v1/wrapped` 私有 summary 和 `GET /v1/wrapped/:username` public-safe Wrapped card。
- Public proof/wrapped 在 public profile 未开启时返回 disabled/null，公开路径不读取 private raw events。
- `showCost=false` 时公开 proof/wrapped 不返回 cost 字段；source/model/workspace breakdown 继续受公开开关控制。
- 从 `source-parsers.ts` 抽出 `source-parsers/shared.ts` 的 JSON/JSONL 读取层，保持 `parseSourceSpecificUsageFile()` 对外入口不变。

## 测试与验证

- 新增 `packages/db/src/repository.contract.test.ts`，覆盖 FileStore ingestion 的 idempotency、wrong-device、cross-device replay、stable identity update、receipt digest、source health、merge issue、public cache、device delete、cost anomalies 和 vault import rollup。
- 扩展 `packages/collector-core/src/source-parsers.test.ts`，覆盖 Gemini tmp chat 和 OpenClaw transcript direct parser，并断言正文不会进入 normalized events。
- 扩展 `packages/db/src/repository.test.ts`，覆盖 active FileStore lock contention 和 vault schema version 不兼容路径。
- 扩展 `apps/api/src/app.test.ts`，覆盖 Public Proof Pack / Wrapped 低敏公开 payload 和私有 wrapped auth gate。

## 文档同步

- README、中文 README、AGENTS、外部 specs、当前功能指南和 v0.4 后续架构建议评估报告已同步 Phase 0/1 完成状态。
- 外部 Update Logs 镜像需继续保持与本 changelog 一致。

## 影响文件

### Apps

- `apps/api/src/app.ts`
- `apps/api/src/app.test.ts`

### Packages

- `packages/collector-core/src/source-parsers.ts`
- `packages/collector-core/src/source-parsers/shared.ts`
- `packages/collector-core/src/source-parsers.test.ts`
- `packages/db/src/repository.ts`
- `packages/db/src/repository.test.ts`
- `packages/db/src/repository.contract.test.ts`

### Docs

- `AGENTS.md`
- `README.md`
- `README.zh-CN.md`
- `docs/changelog/CHANGELOG.md`
- `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\overview.md`
- `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\prd.md`
- `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\sitemap.md`
- `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\api-design.md`
- `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\architecture.md`
- `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\database-design.md`
- `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\testing.md`
- `E:\Project Code\docs\01 - Projects\TokSync\TokSync.md`
- `E:\Project Code\docs\01 - Projects\TokSync\01 - Product\TokSync 文档变更清单.md`
- `E:\Project Code\docs\01 - Projects\TokSync\02 - Architecture\TokSync 技术架构文档.md`
- `E:\Project Code\docs\01 - Projects\TokSync\03 - Guides\当前功能与使用指南.md`
- `E:\Project Code\docs\01 - Projects\TokSync\05 - Reviews\TokSync v0.4 后续架构建议评估报告.md`
- `E:\Project Code\docs\01 - Projects\TokSync\09 - Changelog\Update Logs\CHANGELOG.md`

<a id="2026-05-21-v0-4-security-review-hardening"></a>

## 2026-05-21 - v0.4 security review hardening

日期：2026-05-21

本次更新收敛 v0.4 审查后发现的安全、可观测性和验证门禁缺口：生产 OAuth 增加 PKCE 与更严格 cookie，API 增加 request id、结构化日志和请求体大小限制，Vault 导出明确加密参数，collector 与 CSV/export 边界补上回归测试，并把 GitHub Actions CI 固化为完整发布门禁。

## 概览

- GitHub OAuth start/callback 增加 PKCE S256，生产或 HTTPS 场景使用 `__Host-` session/state cookie，并在 logout/callback 时清理新旧 cookie 名。
- API 所有响应带 `X-Request-Id`，生产或显式开启日志时输出结构化 request log；`/v1/*` 写接口增加 1 MB / 5 MB 请求体上限并返回 `413 payload_too_large`。
- Web 通过 Next.js `headers()` 增加 CSP、Referrer-Policy、X-Content-Type-Options 和 X-Frame-Options。
- Private Usage Vault 新建导出要求至少 16 字符 recovery passphrase，payload 记录显式 scrypt `{ N: 65536, r: 8, p: 1 }` 参数，并保留旧 payload import 兼容。
- CI 新增 GitHub Actions workflow，跑格式、包边界、类型、lint、unit、coverage、build、migration、E2E、visual 和 perf smoke。

## Agent / Collector

- Agent config 写入时尽量设置配置目录 `0700`、配置文件 `0600`；Windows 或受限文件系统无法 chmod 时继续 best-effort。
- Codex token normalizer 先把 cache read clamp 到 input 再扣减 inclusive cached input，避免 cache read 大于 input 时 summary token 总数被高估。
- 新增 source-specific parser tests，覆盖 Cursor CSV cache-write 列、Copilot OTEL body 丢弃和 generic source 回退 shared normalizer。
- Copilot discovery 增加 `COPILOT_OTEL_FILE_EXPORTER_PATH` 环境变量文件路径回归测试。

## API / Storage

- Hosted GitHub OAuth token exchange 会提交 PKCE `code_verifier`，state cookie 可兼容 legacy raw state 和新 JSON/base64url state。
- Rate limit bucket 增加周期性 prune 和最大 bucket 数，避免长时间运行时 map 无界增长。
- SVG 响应继续设置 `image/svg+xml`、`nosniff` 和禁止脚本的 CSP；badge SVG id 改用随机 UUID，避免同进程多次渲染时可预测递增 id。
- CSV metrics export 对 `=`, `+`, `-`, `@`, tab 和 CR 开头的 string cell 加前缀单引号，避免 spreadsheet formula injection。
- Vault import preview 增加错误 passphrase 和 tampered digest API 覆盖；repository 层继续拒绝违反 metrics-only guard 的 vault payload。
- 设备授权 TTL、poll interval、cost spike baseline/multiplier/min delta 和 vault scrypt 参数抽成显式常量，减少隐式 magic number。

## Web / Embed

- Web 当前范围说明同步 CSP/security headers。
- README/中文 README 同步 Vault passphrase 最小长度、显式 scrypt 参数和 `pnpm test:coverage` 验证命令。

## Privacy / Public Data

- Vault artifact 仍只包含 metrics-only 快照，不导出 prompt、assistant reply、tool args、tool output、file content、raw path、plaintext token 或 secrets。
- Vault import 的错误 passphrase、digest mismatch 和 schema/privacy guard 失败不会写入 usage events。
- Collector parser tests 断言 Copilot OTEL prompt body 不会进入 normalized events。
- Public SVG 输出仍只读公开聚合状态，响应 CSP 禁止脚本执行。

## 文档同步

- `README.md` 和 `README.zh-CN.md` 同步安全头、Vault 加密约束和 coverage gate。
- 外部 TokSync docs 已同步 API limit/request id/logging、OAuth PKCE、`__Host-` cookie、agent config 权限、testing gate 和当前功能指南。
- 本次 workflow 继续同步外部 Update Logs 镜像。

## 影响文件

### Apps

- `.github/workflows/ci.yml`
- `apps/agent/src/config.ts`
- `apps/api/src/app.ts`
- `apps/api/src/app.test.ts`
- `apps/web/next.config.mjs`

### Packages

- `packages/collector-core/src/index.ts`
- `packages/collector-core/src/index.test.ts`
- `packages/collector-core/src/source-parsers.test.ts`
- `packages/db/src/repository.ts`
- `packages/db/src/repository.test.ts`
- `packages/embed-renderer/src/index.ts`
- `packages/shared/src/errors.ts`
- `packages/shared/src/schemas.ts`
- `packages/shared/src/schemas.test.ts`
- `package.json`
- `pnpm-lock.yaml`

### Docs

- `README.md`
- `README.zh-CN.md`
- `docs/changelog/CHANGELOG.md`
- `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\api-design.md`
- `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\auth-and-permission.md`
- `E:\Project Code\docs\01 - Projects\TokSync\00 - Specs\testing.md`
- `E:\Project Code\docs\01 - Projects\TokSync\01 - Product\TokSync 文档变更清单.md`
- `E:\Project Code\docs\01 - Projects\TokSync\03 - Guides\当前功能与使用指南.md`
- `E:\Project Code\docs\01 - Projects\TokSync\09 - Changelog\Update Logs\CHANGELOG.md`
- `E:\Project Code\docs\01 - Projects\TokSync\09 - Changelog\Update Logs\CHANGELOG_WORKFLOW.md`

## 验证

- `pnpm exec prettier --check docs/changelog/CHANGELOG.md docs/changelog/CHANGELOG_WORKFLOW.md`
- 外部 Update Logs 镜像 SHA256 parity
- `pnpm test:full`
- `pnpm test:coverage`
- `pnpm db:migrate`
- `rg -n "docs/changelog/update-log|update-log-[0-9]{4}|CHANGELOG.md#" . -g "!docs/changelog/CHANGELOG_WORKFLOW.md" -g "!docs/changelog/CHANGELOG.md"` 无残留匹配
- `git diff --check`

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
