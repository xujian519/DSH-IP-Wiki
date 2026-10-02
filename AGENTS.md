# dsh-ip-wiki · 开发规范（AGENTS.md）

这一篇只放**常驻军规**：每次会话都该在上下文里、每条一两行的规则，每条链接到它的家。事实的家在 `docs/`——一条规则只在一个文件里写全，别处只链接（分层规则见 [文档规范](docs/AGENTS.md)）。

## 家在哪

| 文件 | 装什么 |
|---|---|
| 本文件 | 常驻军规、边界（always / ask first / never） |
| [docs/architecture.md](docs/architecture.md) | 项目构成与**不可违反的架构约束**：改代码前先读 |
| [docs/development.md](docs/development.md) | 五道门禁与命令、本地钩子与 CI、日常流程、构建与重载、验收评测 |
| [docs/testing.md](docs/testing.md) | 什么算证据：负控制、覆盖率纪律、测试哲学 |
| [docs/notes/README.md](docs/notes/README.md) | 决策记录的写法与分类 |
| [docs/TECH_DEBT.md](docs/TECH_DEBT.md) | 已知缺口、已验收批次、未决事项 |
| [docs/AGENTS.md](docs/AGENTS.md) | 文档自身的规范 |
| [README.md](README.md) | 产品说明：功能、安装、配置、库目录约定、边界与限制 |

## 架构与契约

- **改代码前读[架构约束](docs/architecture.md#不可违反的架构约束)。** 那九条违反会被构建或测试拦下，不是风格建议。
- **Client 半边遵守 DSH 动态客户端契约**：单文件 CJS，唯一副作用是 `window.__ModuleLoader__.load({id, factory})`；只有 `react` 四个入口走 shell 模块表，其余内联。构建期由 `client-shape` 插件拦截。
- **守卫头与前缀只有一个家**：`src/shared/wire.ts`，两侧各写一份就是一条必然漂移的缝。
- **`/api` 之外的每条路由自带守卫**：`x-dsh-ip-wiki` 请求头 + `Sec-Fetch-Site` 只接受 `same-origin` / `none`。
- **写入面只有五条 POST**（`/draft/confirm`、`/draft/discard`、`/draft/revert`、`/index/rebuild`、`/card/delete`），其中 `/card/delete` 是唯一不可撤销的写：先剥反链、后删文件、删前留一行审计。
- **写卡片的入口只有两个，且都只生成草稿**：`ip_wiki_draft`（新卡 / 合并）与 `ip_wiki_confirm`（状态确认）。批量脚本直写 `cards/` 是违规的。
- **路径不外泄**：调用方给的路径经 `resolveInside()`；库自身的目录名走 `inside()`。
- **线上边界逐字段校验**（`shared/parse.ts`），缺判别字段就抛错并点名是哪一段。
- **注册即效应**：一切注册走 `ctx.effect()`；两半都把自己的协作者当硬依赖，缺了就抛 `missingService()`，不许静默挂半个插件。
- **真源是磁盘上的卡片**：`index/card-index.json` 只作交叉核对，不是读取来源。
- **凭据不入库、不进仓库、不进日志**：只从库根之外的本地配置读，读不到只降级成关键词检索。

## 流程与证据

- **提交前跑 `pnpm run check`**（五道门禁：typecheck / lint / 覆盖率 / 文档链接 / 笔记格式）；命令与单独诊断见 [development.md](docs/development.md#五道门禁)。
- **本地钩子只做窄检查**：pre-commit 是暂存文件的 lint 与空白、pre-push 是 typecheck；全量五道门禁以 `pnpm run check` 为准，CI 跑的是同一条命令（[development.md](docs/development.md#本地钩子与-ci)）。
- **改行为、架构、契约、流程、格式 → 同一批改动里带一条[决策记录](docs/notes/README.md)**；机械或局部编辑豁免，已有记录归属的决策改成更新那一条。
- **改门禁 → 带负控制**，并按下三步走证明它拦得住：引入回归 → 确认变红 → 回退。变异不变红时先怀疑控制脚本（[证据标准](docs/testing.md#门禁的灵魂是负控制)）。
- **验收证据必须走真实入口**：新增或修改智能体工具要有经注册表语义（`output.schema` ↔ 返回值一致）的测试，`execute` 跑通不算数。
- **断言外部状态**：重读文件、重跑命令、看 HTTP 字节，不信被测对象说它成功了。
- **破坏性验证只对副本或临时目录跑**（删除、批量弃用、覆盖真库文件）；要对真库根动手之前先按时间戳快照 `raw/snapshots/`。
- **碰了 `src/host/**` 或 `src/shared/**` 就要重启 Harness 才生效**（含新增路由）；只改 `src/client/**` 刷新页面即可。
- **改文档按[文档规范](docs/AGENTS.md)分层**：一个事实一个家，别处只链接；写新内容前先找它的家。

## 边界

- **always**：改行为带 note；改门禁带负控制；提交前跑 `pnpm run check`；断言外部状态而不是被测对象的自述；破坏性验证只对副本或临时目录跑。
- **ask first**：改 Host/Client 契约（路由前缀、守卫头、配置字段名）；引入新的运行时依赖（尤其会进 Client 单文件包的那种）；放宽任何门禁。
- **never**：提交 secrets；在 `lib/`（构建产物）里手改代码；绕过 `ctx.effect` 注册；把 `tests/gates/fixtures/` 从 lint 的排除名单里放出来；把覆盖率 `include` 收窄以藏文件；对真实库根跑破坏性负控制脚本。

## 还没有做到的事

见 [docs/TECH_DEBT.md](docs/TECH_DEBT.md)：真机浏览器验证、dispose 断言、1,137 张的语义检索冷启动、文档字数预算、CI 尚未真正跑过等都在那里，别当成已完成。
