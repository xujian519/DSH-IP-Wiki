# Note: 把五道门禁接到执行者上：本地钩子 + CI，并钉住一个 pnpm

Status: implemented

## Problem

规范的执行面是空的：五道门禁齐备、六份负控制齐备，但**只有人跑**。`pnpm run check` 是自觉，不是门禁——漏跑一次，`check` 全绿的证据就归零，而没有任何东西会发现。

具体缺两件，参考模板（`~/projects/开发规范/new-project-standards-template.md`，仓外文件）把它列为 Day 0 与 Week 1：

1. **没有 CI**：没有平台矩阵，没有一条"push / PR 必跑五道门禁"的路径。
2. **没有本地钩子**：项目当时根本不是 git 仓库（`git status` 直接报错），既没有提交前检查，也没有 pre-push。

## Decision

### 1. 仓库落地

`git init -b main`，现有源码树（106 个文件）作为第一次提交；`node_modules/`、`lib/`、`coverage/` 仍由 `.gitignore` 排除。

### 2. CI：[.github/workflows/check.yml](../../../.github/workflows/check.yml)

`push` 与 `pull_request` 触发，一条 job：checkout → `pnpm/action-setup` → `setup-node`（22，缓存 pnpm）→ `pnpm install --frozen-lockfile` → **`pnpm run check`**。最后一步与本地逐字相同，所以"本地绿、CI 红"只可能来自环境差异，不会来自检查项不同。

### 3. 本地钩子：[lefthook.yml](../../../lefthook.yml)

本地窄、CI 全：

| 时机 | 做什么 | 为什么不在这里做全量 |
|---|---|---|
| pre-commit | 暂存 `*.ts`/`*.tsx` 跑 `oxlint --fix --deny-warnings` + `git diff --cached --check` | 不带 `--type-aware`：类型感知 lint 要起 tsgolint 并载入整个 TS 程序，秒级检查会变成分钟级 |
| pre-push | `pnpm run typecheck` | 类型错误是提交后最贵的一类，值得一次两秒的 push |

`package.json` 的 `prepare` 跑 `lefthook install`，所以克隆后一次 `pnpm install` 就把钩子装上——钩子不进版本库，不自动装就等于没有。

### 4. pnpm 的版本只有一个家

`package.json` 加 `"packageManager": "pnpm@10.33.4"`，workflow 里的 `pnpm/action-setup` **不写** `version`。

这是实测逼出来的：钩子环境里 `pnpm` 解析到 `/Users/xujian/.local/bin/pnpm`（corepack shim，无 `packageManager` 时取 corepack 的默认版本 11.18.0），而终端里是 10.33.4。pnpm 11 的 `pnpm exec` 会做依赖状态校验并顺手 `pnpm install`，那次安装失败——于是提交被拦下的**理由是 pnpm 崩了，而不是 oxlint 报错**。这正是规范里"假门禁"那一类：变红了，但红错了地方。钉住版本后，钩子、终端、CI 走同一个 pnpm。

### 5. 负控制

新增 [tests/gates/pipeline.spec.ts](../../../tests/gates/pipeline.spec.ts)（10 条）：

- 检查器只读**声明**不读散文——两份配置的注释里都写着它们要跑的命令，一个被注释满足的检查器，恰好在它要抓的那个回归上变绿。
- 变异副本必须被逐条点名：workflow 停跑 `pnpm run check`、绕过 lockfile 安装、在 action 上又固定 pnpm 版本；钩子丢掉 `{staged_files}`、丢掉 `--fix`、丢掉 typecheck、pre-commit 长成全量 lint。
- 真实三步：把 `.github/workflows/check.yml` 的 `run: pnpm run check` 改成 `echo skipped` → 门禁红并点名 `workflow 不再跑 pnpm run check` → 按字节还原（sha256 一致）→ 复跑 10 条全绿。
- 钩子端真跑过：暂存一个 `export const probe: any = 1` → `git commit` 退出码 1 并点名 `no-explicit-any`；暂存一个行尾空格文件 → 同样被拦；干净树上 `lefthook run pre-push` 退出码 0。

## Alternatives considered

- **零依赖的 `.githooks/` + `core.hooksPath`** —— 落选：模板指定 lefthook，而 lefthook 自带暂存文件过滤与 `stage_fixed` 自动重暂存；手写 shell 要自己处理这两件，且得靠 `prepare` 去 `git config`。好处是不引入新依赖，将来要去依赖可以换回来。
- **husky + lint-staged** —— 落选：两个包做 lefthook 一个包做的事，且 lint-staged 的 glob 语义与 lefthook 的 `{staged_files}` 重叠，多一层要维护的配置。
- **pre-commit 也带上 `--type-aware`** —— 落选：见上表，会把秒级检查变成分钟级；类型感知规则由 pre-push 的 typecheck 与 CI 的全量 lint 兜住。
- **钩子里直接调 `node_modules/.bin/oxlint`，彻底不经过 pnpm** —— 落选：`packageManager` 钉住版本后 pnpm 的解析已经确定；保留 `pnpm run typecheck` 还能让 pre-push 与 `package.json` 的脚本保持同一个源，不必在钩子里重抄一遍命令。
- **CI 里连跑 `pnpm run build`** —— 落选：本轮按模板"一条 job 跑 `pnpm run check`"落地。留意 `client-shape` 那条架构约束只在 `pnpm run build` 时拦，所以它目前仍不在 CI 覆盖面内，已记进[台账](../../TECH_DEBT.md)。
- **在 workflow 里写 `version: 10`** —— 落选：与 `packageManager` 抢所有权，pnpm/action-setup 在两处版本不一致时会直接拒绝运行；版本只留一个家。

## Consequences

- **门禁第一次有了执行者**：提交前有窄检查，push 前有类型检查，push / PR 有全量五道。`pnpm run check` 从"自觉"变成"兜底"。
- **成本**：每个提交多约 0.2 秒（lint 暂存文件）、每次 push 多约 2 秒（typecheck）。
- **新增一条构建期依赖**：`lefthook` 进 devDependencies，不进 Client 单文件包，也不进运行时。
- **CI 还没有真的跑过**：仓库没有远端，所以这个 workflow 一次都没执行过——"CI 绿"目前只是"同一条命令在本地绿"（[台账](../../TECH_DEBT.md)）。
- **未做**：平台矩阵（只在 ubuntu + node 22）；`pnpm run build` 与 `client-shape` 门禁不在 CI 里。两条都记在[台账](../../TECH_DEBT.md)。
