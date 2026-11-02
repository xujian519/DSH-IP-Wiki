# Note: 确认入库 = 状态确认草稿（`kind: 'status'`），按磁盘现算只翻一行

Status: implemented

## Problem

卡片库里有两种"入库"含义被混成了一种。读侧只认 `status`：`confirmDraft` 落库时**不改 status**，所以迁移脚本直写进来的 130 张卡全是 `status: draft`，而检索、索引、门禁都不看这一档（唯一被分支的是 `deprecated`）。结果是标签与行为不一致——面板卡头写「草稿」、状态条按 `draft` 计数，插件却把它们当正式卡检索；而**没有任何动作**能把一张已入库的卡变成 `confirmed`。

同时暴露了第二个问题：全量迁移脚本 `tools/migrate_full.py` 直接写 `cards/`，`.dsh-ip-wiki/log.md` 里没有一行迁移记录，`archive/` 里也没有草稿——违反了本项目"`cards/` 只被 `confirmDraft` 写"这条不变量。用户看到的是"没有确认入库机制"。

## Decision

1. **确认也是一次写库，因此走同一条路**：新增智能体工具 `ip_wiki_confirm`，`paths` 指名卡片或 `scope: "all-draft"` 全库，为每张仍是 `draft` 的卡生成一份**状态确认草稿**（`kind: 'status'`）。落库仍然是用户在面板点「确认落库」/「全部确认」，或 `ip_wiki_review(action="confirm")`——**写路由没有增加第五条**。
2. **草稿只表示"翻 status 一行"，不携带正文快照**：`confirmDraft` 与 `viewDraft` 对 `kind: 'status'` 的草稿都**按磁盘上卡片当时的内容现算** `confirmedText()`（`setFrontmatterFields(source, { status: '"confirmed"' })`）。排队期间正文被改过也不会被旧文本覆盖；卡片已被删则**响亮拒绝**（`needs the card on disk, and there is none`）。快照式草稿在这里是错的：它会把"确认"变成"用旧正文回写"。
3. **幂等键是卡片，不是文本**：`statusDraftIdFor` 只哈希 `root | target | "status:confirmed"`，所以卡片被改写后重新排队仍命中同一份待确认草稿，不会堆出第二份。（`draftIdFor` 按内容哈希，用在这里就会。）
4. **跳过要说明理由，不静默**：`already-confirmed` / `deprecated` 以 `action: 'skipped'` 回报，计数出现在工具结果里；`paths` 里给出非 `cards/*.md`、越界路径、没有卡型的文件、找不到的文件或一批超过 300 张，一律拒绝。
5. **检索照常返回未确认卡，但标出来**：`SearchHit.status` 新增（Host 组装、线格式解析、工具渲染三处一起改），结果里出现「状态：未确认 / 已废弃」。排除未确认卡等于把 130 张库清空，标注才既保检索能力又让引用者知情。
6. **面板加两件东西**：状态条的「未确认 N / 已确认 M」计数，以及待确认草稿区的「全部确认」与落库后的「回滚」（整批按**相反顺序**逐份 `revertDraft`，每份的索引字节各自放回，于是整批回滚后库逐字节复原）。
7. **确认不是质量结论**：状态确认不改变门禁 finding 计数（真库实测确认前后一致），也不动 `confidence` / 分类；重复与缺分类留给合并草稿与人工复核。

## Alternatives considered

- **加第五条写路由 `POST /cards/confirm`** — 落选：写卡片的入口就应只有一个 `confirmDraft`；批量确认用既有 `/draft/confirm` 逐份调用即可（面板就是这么做的），多一条路由等于多一条要维护的备份/日志路径。
- **把 130 张卡直接由脚本改成 `confirmed`** — 落选：那正是这次要修的错误——没有草稿、没有差异预览、没有用户确认、没有日志。用同一个错误修另一个错误。
- **草稿存正文快照（与普通卡草稿同形）** — 落选：见决策 2，排队期间卡片被改动就会把旧正文写回去。
- **确认时顺便修重复 / 补齐分类** — 落选：那会把"我看过了"混成"我改过了"，且与合并草稿的职责重叠；用户要的是可分辨的两件事。
- **检索排除未确认卡** — 落选：全库都是未确认时等于库不可用；标注比屏蔽更诚实。
- **`status: draft` 视为"不可用"** — 落选：真源规则只把 `deprecated` 当历史；把未确认升级为不可用会让 130 张卡同时消失。

## Consequences

- 换来：标签与行为一致（`status` 有真实语义）、迁移的 130 张卡有了正规的补确认路径、批量确认与整批回滚都有哈希证据（真库副本 130 confirm + 130 revert → 树哈希复原）。
- 付出：`DraftKind` 多了第三档 `'status'`，`viewDraft` / `confirmDraft` 各多一条按磁盘现算的分支；面板的"落库横幅"从单份变成"一份或一批"（`landed.ids`），批量失败时横幅只覆盖已落库的那些。
- 遗留：**真实迁移脚本仍会直写 `cards/`**（那是仓库外的库侧工具，本次只补了它的补救路径与规范条目）；Wiki 批次（1,235 页）尚未迁移。
- 后续（2026-09-29）：这条决策让 `draft` 与 `deprecated` 都"可见但被标出"。合并落库后真机暴露：`deprecated` 只是被标出、仍能排到在用卡前面。**已废弃现在排在所有在用卡之后**（`docs/notes/implemented/2026-09-29-deprecated-cards-rank-last.md`）；`draft` 的可见性不变。
- 后续（2026-11-02）：状态条默认档只留未确认（有则）。已确认数还在，收到「详情」（[卡片树与状态条方案 A](2026-11-02-tree-status-scheme-a.md)）。
