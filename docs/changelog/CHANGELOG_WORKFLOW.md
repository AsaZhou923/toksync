# TokSync Changelog Workflow

## 目的

把“阅读当前 git 工作区更新 -> 追加统一 changelog -> 同步外部归档副本 -> 同步项目说明与必要入口 -> 验证 -> 需要时 commit / push”固定成可重复执行的流程。

TokSync 只维护一份仓库内 changelog：

- `docs/changelog/CHANGELOG.md`

外部文档库的 Update Logs 目录只作为仓库内 changelog 目录的镜像副本：

- `E:\Project Code\docs\01 - Projects\TokSync\09 - Changelog\Update Logs`

不要新建 `docs/changelog/update-log-YYYY-MM-DD-topic.md` 或外部 `Update Logs\update-log-YYYY-MM-DD-topic.md`。历史和后续发布说明都应合并进统一 `CHANGELOG.md`，通过稳定锚点定位到对应条目。

## 适用场景

- 用户要求“阅读今天的更新并写更新文档”
- 用户要求“整理 release / 更新说明 / changelog”
- 用户要求“同步 README / 外部 TokSync 文档”
- 用户要求“确认无误后 commit / push”

## 固定原则

1. 先读工作区改动，再写文档。不要凭记忆总结。
2. 只记录这次工作区中的真实改动，不混入历史版本内容。
3. 单一事实来源是 `docs/changelog/CHANGELOG.md`。
4. 每条 changelog 必须有稳定锚点，格式为 `YYYY-MM-DD-short-topic`。
5. 仓库内 changelog 与外部 Update Logs 目录必须同步，外部目录只是镜像副本。
6. README、AGENTS、站内 docs 页面、外部 TokSync specs/guides 只在内容受影响时同步，不为“更新而更新”制造无关 diff。
7. TokSync 是 metrics-only 产品，changelog 不得包含 prompt、assistant 回复、工具参数、工具输出、文件内容、密钥、真实用户日志、原始绝对项目路径或可识别的私有使用数据。
8. 先验证，再 commit，再 push；未执行的验证不要写成“通过”。
9. 提交信息必须遵守仓库的 Lore Commit Protocol。
10. workflow 如果和当前代码结构有出入，以代码中的真实入口为准，并同步更新本文档，避免继续传播旧路径。

## 涉及文件

### changelog 文档

- `docs/changelog/CHANGELOG.md`
- `docs/changelog/CHANGELOG_WORKFLOW.md`

如果 `CHANGELOG.md` 尚不存在，在第一次实际写发布记录时创建它，并把第一条记录放在文件顶部说明之后。

### 外部 Update Logs 归档

- `E:\Project Code\docs\01 - Projects\TokSync\09 - Changelog\Update Logs\CHANGELOG.md`
- `E:\Project Code\docs\01 - Projects\TokSync\09 - Changelog\Update Logs\CHANGELOG_WORKFLOW.md`

该目录必须和仓库内 `docs/changelog` 保持同款结构：只保留统一 `CHANGELOG.md` 和 `CHANGELOG_WORKFLOW.md`，不要保留旧的 `update-log-*.md` 拆分文件。若仓库内 `CHANGELOG.md` 尚未创建，外部目录可以只同步 `CHANGELOG_WORKFLOW.md`。

新增条目的锚点格式：

```markdown
<a id="YYYY-MM-DD-short-topic"></a>

## YYYY-MM-DD - short topic
```

示例：

```markdown
<a id="2026-05-17-device-sync-privacy-hardening"></a>

## 2026-05-17 - device sync privacy hardening
```

### 项目级说明文件

- `README.md`
- `README.zh-CN.md`
- `AGENTS.md`
- 其他已存在的 agent 指南或 README 变体

只同步会影响后续开发者、代理或用户理解的内容。产品范围、API 合约、隐私边界或数据形状变化时，还要同步外部 TokSync specs。

### 外部 TokSync 文档库

当前外部项目文档位于：

- `E:\Project Code\docs\01 - Projects\TokSync`

常见同步目标：

- `00 - Specs\overview.md`
- `00 - Specs\prd.md`
- `00 - Specs\architecture.md`
- `00 - Specs\api-design.md`
- `00 - Specs\database-design.md`
- `00 - Specs\auth-and-permission.md`
- `00 - Specs\local-development.md`
- `00 - Specs\testing.md`
- `01 - Product\TokSync 文档变更清单.md`
- `03 - Guides\当前功能与使用指南.md`

当代码改变产品 scope、API contract、privacy boundary、data shape、local-dev 方式或测试策略时，仓库文档和外部文档要一起对齐。

### 站内文档

当前常见站内文档包括：

- `apps/web/app/docs/page.tsx`
- `apps/web/app/docs/getting-started/page.tsx`
- `apps/web/app/docs/embed/page.tsx`
- `apps/web/app/page.tsx`

只有用户可见入口、文案或功能说明受影响时才修改这些文件。

## 标准执行步骤

### 1. 确认当前状态

在仓库根目录执行：

```powershell
git status --short --branch
git diff --stat
```

确认当前分支、未提交修改范围，以及改动集中在哪些模块。TokSync 工作区可能有大量既有修改，必须区分本次新增内容和已有用户改动。

### 2. 阅读当前修改

先看总体 diff：

```powershell
git diff
```

必要时按目录拆读：

```powershell
git diff -- apps/agent
git diff -- apps/api
git diff -- apps/web
git diff -- apps/worker
git diff -- packages
git diff -- docs
git diff -- README.md README.zh-CN.md AGENTS.md
```

新增文件也要打开全文看，不要只看 `git diff --stat`。

阅读时必须提炼出下面信息：

1. 用户能感知到的变化
2. Agent CLI 或 collector 变化
3. API、repository、数据库或数据合约变化
4. Web dashboard、public profile、badge/embed 或 docs 页面变化
5. 隐私边界、public/private separation 或 metrics-only 影响
6. 验证方式和新增测试

### 3. 确定条目 ID 与标题

条目 ID 使用日期和短主题：

```text
YYYY-MM-DD-short-topic
```

同一个 ID 同时用于：

- changelog 锚点：`<a id="YYYY-MM-DD-short-topic"></a>`
- README 或外部文档中的最新 changelog 链接

短主题用英文 kebab-case，保持稳定，不要后续随文案微调频繁改锚点。

### 4. 追加 changelog 条目

编辑 `docs/changelog/CHANGELOG.md`，把新条目追加到文件顶部说明文字之后、旧条目之前。

建议结构：

```markdown
<a id="YYYY-MM-DD-short-topic"></a>

## YYYY-MM-DD - short topic

日期：YYYY-MM-DD

本次更新解决了什么问题，先用一小段说明清楚。

## 概览

- 3 到 5 条核心变化

## 用户可见变化

- ...

## Agent / Collector

- ...

## API / Storage

- ...

## Web / Embed

- ...

## Privacy / Public Data

- ...

## 文档同步

- ...

## 影响文件

### Apps

- ...

### Packages

- ...

### Docs

- ...

## 验证

- ...
```

写作要求：

1. 第一段讲清这次更新解决了什么问题。
2. 优先写用户可见变化，再写工程补充。
3. 只保留本次真正涉及的模块章节；没有变化的章节删除。
4. `## 影响文件` 只写本次改动真正涉及的文件。
5. `## 验证` 里写实际执行过或应该执行的命令；未执行的命令必须标明未执行。
6. 区分已实现的 opt-in leaderboard 与尚未实现的 leaderboard 扩展、billing、content sync 等未来功能，不把计划写成当前能力。

### 5. 同步外部 Update Logs 归档

仓库内 `docs/changelog` 是事实来源，外部目录是镜像副本。每次更新 `CHANGELOG.md` 或 `CHANGELOG_WORKFLOW.md` 后，立刻执行：

```powershell
$archive = 'E:\Project Code\docs\01 - Projects\TokSync\09 - Changelog\Update Logs'
New-Item -ItemType Directory -Force -Path $archive | Out-Null
Get-ChildItem -LiteralPath $archive -File -Filter 'update-log-*.md' | Remove-Item

$files = @('docs\changelog\CHANGELOG_WORKFLOW.md')
if (Test-Path -LiteralPath 'docs\changelog\CHANGELOG.md') {
  $files = @('docs\changelog\CHANGELOG.md') + $files
}

Copy-Item -LiteralPath $files -Destination $archive -Force

$hashTargets = @()
foreach ($file in $files) {
  $hashTargets += $file
  $hashTargets += Join-Path $archive (Split-Path -Leaf $file)
}
Get-FileHash -Algorithm SHA256 -LiteralPath $hashTargets
```

要求：

1. 外部目录最终只应包含 `CHANGELOG.md` 和 `CHANGELOG_WORKFLOW.md`。
2. 已存在文件的仓库版本和外部副本 SHA256 必须一致。
3. 如果本 workflow 本身也被修改，先保存 workflow，再重新执行本步骤，确保外部副本包含最新流程。

### 6. 同步项目说明与外部 specs

按影响范围选择同步目标：

- 用户安装、运行、同步命令变化：更新 `README.md`、`README.zh-CN.md`、外部 `local-development.md` 或使用指南。
- API shape、HTTP route、auth 行为变化：更新外部 `api-design.md`、`auth-and-permission.md`。
- schema、repository、migration、rollup 变化：更新外部 `database-design.md`。
- 产品范围、MVP 边界、roadmap 变化：更新外部 `prd.md`、`overview.md`。
- agent 操作约束、包边界或验证命令变化：更新 `AGENTS.md`。

同步时必须明确区分“当前已实现”和“目标架构 / 未来计划”。

### 7. 复查文档与入口是否一致

至少检查下面内容是否对齐：

- `docs/changelog/CHANGELOG.md` 是否存在对应 `<a id="..."></a>`。
- README 或外部文档中的 changelog 链接是否指向最新锚点。
- 仓库中是否残留 `docs/changelog/update-log-*.md` 引用。
- 外部 Update Logs 目录是否已经删除旧的 `update-log-*.md`。
- 外部 `CHANGELOG.md` / `CHANGELOG_WORKFLOW.md` 是否与仓库内文件哈希一致。

推荐命令：

```powershell
rg -n "docs/changelog/update-log|update-log-[0-9]{4}|CHANGELOG.md#" .
Get-ChildItem -LiteralPath 'E:\Project Code\docs\01 - Projects\TokSync\09 - Changelog\Update Logs'
```

### 8. 运行验证

先按改动范围选择针对性验证，再跑必要的基础验证。没跑过的验证不要写“通过”。

仅文档或 workflow 改动至少执行：

```powershell
pnpm exec prettier --check docs/changelog/CHANGELOG_WORKFLOW.md
```

如果 `CHANGELOG.md` 也被创建或更新：

```powershell
pnpm exec prettier --check docs/changelog/CHANGELOG.md docs/changelog/CHANGELOG_WORKFLOW.md
```

changelog 或 workflow 改动必须验证外部归档副本一致：

```powershell
$archive = 'E:\Project Code\docs\01 - Projects\TokSync\09 - Changelog\Update Logs'
Get-FileHash -Algorithm SHA256 -LiteralPath 'docs\changelog\CHANGELOG_WORKFLOW.md',"$archive\CHANGELOG_WORKFLOW.md"
```

共享 schema、API 合约或包边界变化时执行：

```powershell
pnpm check:boundaries
pnpm typecheck
pnpm test
```

collector 或 agent CLI 变化时补充：

```powershell
pnpm test -- packages/collector-core
pnpm agent sync --dry-run --fixture ./packages/test-fixtures/codex/basic
```

API、repository、sync、device、public profile 或 embed 行为变化时补充：

```powershell
pnpm test -- apps/api packages/db packages/embed-renderer packages/privacy
```

Web UI 或 public SVG 变化时补充：

```powershell
pnpm --filter @toksync/web typecheck
pnpm build
pnpm test:e2e
pnpm test:e2e:hosted
pnpm test:visual
```

广泛变更或准备发布时执行：

```powershell
pnpm test:full
```

代码安全审查或依赖变更时另外执行 `pnpm audit --prod`。记录公告严重度、适用条件和修复后的审计结果；公告命中不等于当前路由可利用。升级现有依赖后重新运行相关验证，不将升级前的结果当成升级后的证据。

### 9. 最终复核

在 commit 前至少再看一次：

```powershell
git diff -- docs/changelog README.md README.zh-CN.md AGENTS.md
git status --short
rg -n "docs/changelog/update-log|update-log-[0-9]{4}" .
Get-ChildItem -LiteralPath 'E:\Project Code\docs\01 - Projects\TokSync\09 - Changelog\Update Logs'
```

确认：

1. 只有一份仓库内 changelog：`docs/changelog/CHANGELOG.md`。
2. 旧的 `docs/changelog/update-log-*.md` 文件没有作为入口继续存在。
3. README、AGENTS 和外部 specs 没有继续传播旧路径或旧事实。
4. 外部 Update Logs 目录只保留统一 changelog 与 workflow 副本。
5. 工作区内容就是准备提交的内容，并且没有误碰用户既有改动。

### 10. commit

只有在用户要求提交时执行：

```powershell
git add -A
git commit
```

提交信息必须遵守 Lore Commit Protocol。

### 11. push

只有在用户要求推送时执行：

```powershell
git branch --show-current
git push origin <branch>
```

如果远端提示仓库迁移，记录提示内容；只要 push 成功就不需要重复操作。

## 交付时的标准回复内容

完成后汇报至少包含：

1. 统一 changelog 路径
2. 已更新的 workflow 路径
3. 已同步的外部 Update Logs 目录
4. 已同步的 README、AGENTS、外部 specs 或站内文档
5. 实际跑过哪些验证
6. 是否还有未处理风险

## 禁止事项

- 不要新建 `docs/changelog/update-log-*.md`。
- 不要在外部 Update Logs 目录继续保留 `update-log-*.md`。
- 不要只改 `docs/changelog` 而漏掉外部 Update Logs 镜像。
- 不要把未来计划写成当前实现。
- 不要把 prompt、assistant 回复、工具参数、工具输出、文件内容、密钥、真实用户日志或原始绝对项目路径写进 changelog。
- 不要把未执行的验证写成已通过。
- 不要在工作区有未知冲突时直接提交。
- 不要为了“同步”改动不相关文档。

## 快速清单

执行前：

- `git status --short --branch`
- `git diff --stat`
- `git diff`

写文档：

- 更新 `docs/changelog/CHANGELOG.md`
- 同步 `E:\Project Code\docs\01 - Projects\TokSync\09 - Changelog\Update Logs`
- 按需更新 `README.md`
- 按需更新 `README.zh-CN.md`
- 按需更新 `AGENTS.md`
- 按需更新外部 TokSync specs / guides
- 按需更新站内 docs 页面

验证：

- Prettier 检查 touched markdown
- 外部 changelog 副本 `Get-FileHash`
- 与本次代码改动直接相关的 pnpm 验证
- 广泛发布前跑 `pnpm test:full`

提交：

- 仅在用户要求时 `git add -A`
- Lore commit message
- 仅在用户要求时 `git push origin <branch>`
