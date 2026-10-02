# Note: 规范分家：根 AGENTS.md 只留常驻军规，事实各回各家，文档也有门禁

Status: implemented

## Problem

规范只有一篇 20k 的 `AGENTS.md`：架构约束、门禁、覆盖判定、已知缺口、边界、测试哲学全挤在一处。这带来三个具体后果：

1. **事实没有家**：同一个事实（例如"写入面五条 POST"）在规范、README、决策记录里各写一遍，改一处就要记得改另两处。
2. **指针会漂**：决策记录里写着「AGENTS §7.1」「AGENTS §8」这类按小节号定位的引用——规范一重排，引用就悄悄指错地方，而没有任何东西会发现。
3. **文档层零机器验证**：换名一个文件、删掉一条决策记录的 `## Alternatives considered`，肉眼 review 基本看不出，`pnpm run check` 也不会红。

参照 `~/projects/deepseek-harness` 的形态：根 `AGENTS.md` 只放"每次会话都要在上下文里的常驻军规"（每条一两行、链接到它的家），事实按层分家，文档自身也有规范，且每类规则都配一个能红的门禁。

## Decision

### 1. 分家：一篇文档一个家

| 文件 | 装什么 |
|---|---|
| [AGENTS.md](../../../AGENTS.md) | 常驻军规 + 边界（always / ask first / never） |
| [docs/architecture.md](../../architecture.md) | 项目构成 + 九条不可违反的架构约束 |
| [docs/development.md](../../development.md) | 五道门禁与命令、日常流程、构建与重载、验收评测 |
| [docs/testing.md](../../testing.md) | 什么算证据：负控制、覆盖率纪律、测试哲学 |
| [docs/notes/README.md](../README.md) | 决策记录的写法与分类 |
| [docs/TECH_DEBT.md](../../TECH_DEBT.md) | 已知缺口、已验收批次、未决事项、事故记录 |
| [docs/AGENTS.md](../../AGENTS.md) | 文档自身的规范与 slop 清单 |

规则一条没丢：旧文里的九条架构约束、门禁表、覆盖率判定思路、负控制三份证明、测试哲学四条、边界三档、已知缺口十条全部搬进上述文件；只有"改代码需重启"这类流程事实归了 [development.md](../../development.md#构建与重载)，"验收证据必须走真实入口"归了 [testing.md](../../testing.md#验收证据必须走真实入口)——它们本来就是流程与证据，不是常驻军规。

### 2. 根 AGENTS.md 不再编号

常驻军规改用条目（`- **加粗的规则**：一句理由 + 链接`），跨文档引用一律用**锚点链接**而不是 `§N`。原来三条决策记录里的四处 `AGENTS §x` 引用在同一批改动里改成了锚点链接。

### 3. 两道文档门禁

单一实现 `tests/gates/docs.ts`，两个 spec 各自带负控制：

- `docs-links.spec.ts`：`AGENTS.md` / `README.md` / `docs/**` 里的相对链接必须指向存在的文件；带 `#锚点` 时目标文件里必须有 slug 相同的标题（重复标题按 GitHub 的 `-1` 后缀规则）。代码块、行内代码、外链、仓外链接各有明确处置。
- `notes.spec.ts`：`docs/notes/**` 的路径必须是 `{proposed|implemented|rejected}/yyyy-mm-dd-<短题>.md`，`Status:` 必须与目录一致，四段骨架按序必写，`## Alternatives considered` 至少要列一条备选。

两道门禁是 vitest spec，所以随 `pnpm run check` 的第三个门禁（`test:coverage`）一起跑；另加 `pnpm run verify:docs` 只为单独诊断快一点，不是第二条必经路径。

### 4. 两条旧决策记录的收尾小节改名

`2026-09-29-panel-b-tier-and-card-deletion.md` 的 `## 验收` 与 `2026-09-29-panel-visual-and-safety-pass.md` 的 `## 验收与负控制` 改成 `## Consequences`（内容一字未动）。不这么改，笔记门禁就得为旧格式开口子，而宽松的口子会让门禁变成装饰。

### 5. 负控制怎么证明的

- **fixture 负控制**：坏链接三类（缺文件 / 缺锚点 / 仓外）、坏笔记四类（非法状态目录、备选段为空、段落顺序错位、文件名无日期）必须被逐条点名；同时各有一个**正控制**（好链接样例、格式正确的笔记）必须零问题——门禁不能是恒红的。
- **真实回归三步走**：在 `docs/testing.md` 里把一条链接改成不存在的目标 → 门禁红并点名 `docs/testing.md: 链接目标不存在`；把 `2026-09-29-delete-audit-line.md` 的 `## Alternatives considered` 改成 `## Alternatives` → 门禁红并点名缺该段。两次都先备份、跑完按字节还原（sha256 与改动前一致），再复跑为绿。

## Alternatives considered

- **继续维护一篇长规范的** —— 落选：分家的动机正是"事实没有家"；一篇长文里加门禁，门禁与它要守的规则又会挤在同一处。
- **门禁按 harness 形态写成 `scripts/` + tsx 可执行脚本** —— 落选：本项目没有 `tsx` 运行时依赖，现有门禁的证明本来就都是 vitest spec；引入第二个运行器等于多一条只有它自己走的路径。
- **让 `check` 显式第四次调用 `verify:docs`** —— 落选：`test:coverage` 已经跑到那两个 spec，会是同一批断言跑两遍；冗余步骤还会让人误以为两道门禁不在 `check` 里。
- **链接门禁只查"文件存在"，不查锚点** —— 落选："指向存在的文件"不足以保证"落在对的地方"，而本项目的规则全靠跨文件锚点链接。
- **给两条旧格式笔记开白名单** —— 落选：门禁为历史开口子之后，下一次就没人知道口子在哪；改两个小节名的成本几乎为零。
- **同时上 harness 的字数预算门禁（`verify-doc-budgets`）** —— 落选：本轮只承诺两道门禁，预算上限需要先有真实的文档长度基线；已作为未做项记进 [TECH_DEBT.md](../../TECH_DEBT.md#文档门禁没有字数预算)。

## Consequences

- **规则一条没丢，位置全变**：找"写入面有几条 POST"去 [architecture.md](../../architecture.md#不可违反的架构约束)，找"覆盖率怎么判定"去 [testing.md](../../testing.md#覆盖率每个文件-100)，找"还没做什么"去 [TECH_DEBT.md](../../TECH_DEBT.md)。
- **指针不再漂**：跨文档引用由链接门禁校验，包括锚点；`§N` 这种按序号定位的引用在本项目里不再出现。
- **门槛提高**：以后新增文档要能被链接门禁扫过；新增决策记录必须四段齐全、备选非空；以后放宽这两条，得先改门禁并补负控制。
- **本轮实测**：`pnpm run check` 全绿——typecheck、oxlint `--deny-warnings` 0 warning、**529 通过 / 7 跳过**、`src/**` 每文件四项 100%；其中新增 8 条（两道门禁各 4 条）。
- **未做**：文档字数预算门禁；README 与两条记录里"设计文档 §N"这类指向仓外文件的引用无法机器核对（两处都记在 [TECH_DEBT.md](../../TECH_DEBT.md)）。
- **未做真机核对的既有缺口没有变化**：本轮只动 `.md` 与 `tests/gates/`，没有碰 `src/`，面板的浏览器验证缺口仍在台账里。
