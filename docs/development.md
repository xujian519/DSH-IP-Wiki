# 开发流程

改代码的日常动作、门禁、构建与重载都在这一篇。约束本身归 [architecture.md](architecture.md)，证据标准归 [testing.md](testing.md)，常驻军规归 [AGENTS.md](../AGENTS.md)。

## 五道门禁

```sh
pnpm run check          # 一次跑完下面五道
pnpm run typecheck      # 门禁 1
pnpm run lint           # 门禁 2
pnpm run test:coverage  # 门禁 3（两道文档门禁也在里面，见下）
pnpm run verify:docs    # 只跑两道文档门禁（诊断用，快）
```

| 门禁 | 命令 | 机器上保证什么 | 家 |
|---|---|---|---|
| typecheck | `tsc --noEmit -p tsconfig.json` | `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noFallthroughCasesInSwitch` + `noImplicitOverride`；**spec 也在检查范围内** | `tsconfig.json` |
| lint | `oxlint . --type-aware --deny-warnings` | `any`=error、`no-floating-promises`、`no-unsafe-*`、`no-non-null-assertion`、switch 穷尽、`ban-ts-comment` | `.oxlintrc.json` |
| coverage | `vitest run --coverage` | `src/**` **每个文件、四项指标都 100%** | `vitest.config.ts` |
| 文档链接 | `tests/gates/docs-links.spec.ts` | `AGENTS.md` / `README.md` / `docs/**` 里的相对链接都指向存在的文件与存在的标题锚点 | `tests/gates/docs.ts` |
| 笔记格式 | `tests/gates/notes.spec.ts` | `docs/notes/**` 的路径、`Status` 与骨架四段合规 | `tests/gates/docs.ts` |

两道文档门禁是 vitest spec，所以随 `pnpm run test:coverage` 一起跑——`pnpm run check` 因此也覆盖它们；`pnpm run verify:docs` 只是为了单独诊断快一点，不是另一条必经路径。

两条配套纪律：

- `any` 用行内窄范围抑制 + 一句理由；**禁止文件级 / 全局关规则**。
- 规则冲突用「off + 注释理由」，不用静默。目前只有一处：CLI 的 `--ignore-pattern 'tests/gates/fixtures/**'`（见 [testing.md](testing.md)）。

**本项目的门禁没有例外**：不设覆盖率地板表、不排除任何 `src` 文件。

## 本地钩子与 CI

五道门禁由两道执行面兜住：本地钩子做窄检查，CI 做全量排练。钩子配置在 [lefthook.yml](../lefthook.yml)，CI 在 [.github/workflows/check.yml](../.github/workflows/check.yml)（[决策记录](notes/implemented/2026-10-02-local-hooks-and-ci.md)）。

| 时机 | 做什么 |
|---|---|
| pre-commit | 暂存的 `*.ts` / `*.tsx` 跑 `oxlint --fix --deny-warnings`（**不带** `--type-aware`）+ `git diff --cached --check` |
| pre-push | `pnpm run typecheck` |
| CI（push / PR） | `pnpm install --frozen-lockfile`，然后跑完整的 `pnpm run check` |

钩子不进版本库，靠 `package.json` 的 `prepare`（`lefthook install`）在 `pnpm install` 时装上——克隆后不装就等于没有。pnpm 的版本只在 `package.json` 的 `packageManager` 里写一次；在 workflow 的 `pnpm/action-setup` 上再写一遍会被 action 拒绝。

pre-commit 故意不含 `--type-aware`：类型感知 lint 要载入整个 TS 程序，秒级检查会变成分钟级。类型感知的规则由 pre-push 的 typecheck 与 CI 的全量 lint 兜住。

两道执行面自己也有门禁：`tests/gates/pipeline.spec.ts` 断言 workflow 与钩子还在跑该跑的命令，并用变异副本证明它会红（见 [testing.md](testing.md#门禁的灵魂是负控制)）。

## 日常流程

1. **先读** [architecture.md](architecture.md) 的九条约束——违反它们的代码会被构建或测试拦下，不是风格建议。
2. **改**：改动面尽量小；函数职责要改就改它的测试与调用点，别就地兼容。
3. **验证**：跑 `pnpm run check`；改了门禁还要按 [testing.md](testing.md#门禁的灵魂是负控制) 的三步走证明它拦得住。
4. **记**：非平凡变更（改行为 / 架构 / 契约 / 流程 / 格式）在同一批改动里带一条决策记录，格式见 [notes/README.md](notes/README.md)。
5. **文档同步**：被改动的行为若在某篇文档里有描述，同一批改动里更新它；分层规则见 [文档规范](AGENTS.md)。

## 构建与重载

```sh
pnpm run build   # lib/index.js（Host，ESM）+ lib/client.js（Client，CJS）
```

宿主模块在 Harness 启动时载入，所以**碰了 `src/host/**` 或 `src/shared/**`（含新增路由）就必须重启 Harness（或重载 profile）**才生效；**只改 `src/client/**` 时刷新页面即可**。

## 验收评测

真库上的端到端验收（需要本地嵌入端点与真库，故不在 `pnpm run check` 里）：

```sh
DSH_IP_WIKI_EVAL=1 pnpm exec vitest run tests/p1-eval.spec.ts
DSH_IP_WIKI_EVAL=1 pnpm exec vitest run tests/p2-eval.spec.ts
DSH_IP_WIKI_EVAL=1 pnpm exec vitest run tests/p3-eval.spec.ts
DSH_IP_WIKI_EVAL=1 pnpm exec vitest run tests/p4-eval.spec.ts
```

各轮的实测结论与仍然红着的声明线记在 [TECH_DEBT.md](TECH_DEBT.md)。

`p1-eval` 用的是**部署的配置**（`timeoutMs` 20 秒）与**真实的向量缓存**（`~/.dsh/ip-wiki/vectors.json`）：第一次跑要把 1,155 张嵌一遍并写下缓存（实测 498.5 秒），之后同一条命令约 80 秒。缓存被删掉就会重新变慢——这是它的正常代价，不是回归。

## 一次性维护脚本

`scripts/import-wiki.ts`（导入 vault 的 Wiki 页）与 `scripts/merge-duplicates.ts`（批量写合并草稿）是库侧维护工具，**只生成草稿、从不直写卡片**；用法与判定口径归 [README](../README.md)。它们由 `tsc` 一起类型检查。
