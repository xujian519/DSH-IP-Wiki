# Note: 卡片阅读器方案 A

Status: implemented

## Problem

宽窗下卡片阅读器的头区（芯片、删除行、二次确认、「元信息」）没有 `40em` 版心，会比正文更宽。删除单独占芯片下方一行；确认问句和两个按钮挤在同一行，窄栏时按钮被问句顶住。「相关卡片」是一行松散芯片，不报条数；库里没有的 id 与正文里解析失败的双链长得一样，也不说明为什么不能点。目录在至少两个可跳标题时整块铺开，不能收起。正文 h3 及更深仍并成一档（次级色、13px），但字重 500、间距偏紧，扫读时和段落贴在一起。

## Decision

只改 `CardReader`（`src/client/IpWikiPage.tsx`、`src/client/styles.ts`、`src/client/locales.ts`）。左树、检索、草稿、门禁、报告的信息架构不动。

1. **统一版心**。`.iw-meta`、`.iw-read-actions`、`.iw-confirm`、`.iw-details` 加 `max-width: 40em`，与 `.iw-read-title`、`.iw-md*`、`.iw-related`、`.iw-toc` 对齐。散文版心仍是 `40em`，不加字号。
2. **删除进标题行**。`.iw-read-actions` 里标题在左、「删除」在右，仍是 `.iw-btn-danger`，`busy` 时 `disabled`。二次确认仍在芯片行下方展开；阅读器用 `.iw-confirm-stack`：问句在上，`.iw-confirm-actions` 右对齐。文案仍是 `deleteCardAsk`（写明不可回滚）。左树「全部确认」继续用单行 `.iw-confirm`，不套这个修饰类。
3. **相关升框**。`.iw-related` 与 `.iw-toc` 共用边框盒（`0.5px` 的 `border-l1`、圆角 12px、版心 `40em`）。标题是 `relatedHeading` 加条数：中文「相关卡片 · N」，英文「Related · N」。`related` 仍给左树行（英文 Related cards），树的措辞不变。解析不到的是 `span.iw-related-unresolved`，灰字（`label-secondary`）加上 `relatedUnresolved`（「不在库内」/ not in library），不是按钮。`relatedConcepts` 为空时整块不渲染。
4. **本篇目录可折**。仍仅 `headings.length ≥ 2` 才渲染；与卡标题重复的首个 `#` 仍 omit，过滤逻辑不变。目录是默认展开的 `<details class="iw-toc" open>`。不做第三栏，不做 sticky 迷你条。
5. **h3 略加重**。不解冻「h3 及更深并成 `.iw-md-h3`」。该规则的 margin 改为 `20px 0 6px`，字重改为 600；字号 13px 与 `label-secondary` 不变。样式表里其余 `font-weight: 600` 仍被 `tests/client-parts.spec.tsx` 拦住。

## Alternatives considered

- **方案 B（第三栏目录 + sticky 迷你条）** —— 用户确认本轮只做方案 A。第三栏要改阅读区栏数，sticky 在宿主面板高度里没有单独验证过的落点，本轮不引入那套状态。
- **把确认条的上下布局写进共用的 `.iw-confirm`** —— 落选：左树「全部确认」也用这个类，改共用规则会改左树确认行。阅读器单独加 `.iw-confirm-stack`。共用类只加版心；树栏宽 320px，窄于 `40em`，树上看不到差别。
- **加字号或放宽散文版心** —— 落选：沿用[面板视觉一轮](2026-09-29-panel-visual-and-safety-pass.md)，行长靠 `40em`，不靠更大的字。
- **把 h3+ 拆成多档字号** —— 落选：并档是有意的（导入语料标题深到五级，更深的档不再加字号）。只加字重和间距。
- **未解析相关项做成可点的失效链接** —— 落选：与「解析不到就不装成控件」同一条（[B 档](2026-09-29-panel-b-tier-and-card-deletion.md)）。灰字加上「不在库内」，仍然不是按钮。

## Consequences

- 换来：宽窗下头区与正文同一版心；删除与标题同一行，确认问句不再和按钮抢一行；相关块能报条数，库外 id 能被认出来且点不了；目录能折起且默认展开；h3 更好扫，仍是次级色。
- 付出：`.iw-meta` 与 `.iw-confirm` 是共用类，门禁、报告的芯片行以及左树批量确认条也带上 `40em` 上限。树栏比 `40em` 窄，确认条外观不变。草稿阅读器的版式见[草稿阅读器方案 A](2026-11-02-draft-reader-scheme-a.md)。
- 未做：方案 B 的第三栏与 sticky 迷你条。真机视觉验收仍是[既有缺口](../../TECH_DEBT.md#无浏览器真机验证)。本轮证据是 jsdom（`tests/panel.spec.tsx`、`tests/client-parts.spec.tsx`）；这个仓库不起独立的面板页面。
- 左树与顶栏状态条的收束是另一条决策：[卡片树与状态条方案 A](2026-11-02-tree-status-scheme-a.md)。检索命中卡是[检索结果方案 A](2026-11-02-search-results-scheme-a.md)。本条只约束阅读器。
