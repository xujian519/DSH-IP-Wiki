# Note: 门禁色点方案 B2-A

Status: implemented

## Problem

质量门禁的结论在状态条和左栏各有一份库级摘要，阅读器按 path 把同一张卡的 findings 收成一组（[面板方案 A](2026-11-02-lint-draft-hints-scheme-a.md)、[待确认草稿与门禁分组方案 B1](2026-11-02-lint-draft-queue-scheme-b1.md)）。树行和卡片头仍不标这张卡自己有没有严重或警告。要知道「打开的这张卡」或「扫到的这一行」是否被门禁点过名，得先打开整份报告再对路径。

## Decision

只改卡片树行和 `CardReader` 芯片行（`src/client/IpWikiPage.tsx`、`src/client/styles.ts`、`src/client/locales.ts`）。索引从面板已经拿到的 `lint.findings` 派生，不改 Host、路由和 `LintReport`。不引依赖，Client 仍是单文件。

1. **path → {critical, warning}。** `lintCountsByPath` 按 path 累加。`tier === 'suggestion'` 不进表。`path === ''` 的库级 finding 不进表，因此不会造出树行色点。一张卡两项都是 0 时没有索引项。
2. **树行只加色点。** 分组行和「筛选标题」命中行，在现有状态 meta 旁边，仅当该 path 有严重或警告时渲染 `.iw-lint-dot`（6px）。有严重则 `data-tone="error"`，否则 `data-tone="warn"`。色点没有文字。`title` 与 `aria-label` 都是「严重 N · 警告 M」（英文 `critical N · warning M`），两档都写，含 0。行的 `title` 仍是[卡片树与状态条方案 A](2026-11-02-tree-status-scheme-a.md) 的标题、概念和相关条数。行仍是 `.iw-row-line`（`min-height: 30px`）。
3. **卡头一枚芯片。** 有索引项时，`.iw-meta` 末尾加 `button.iw-chip`。有严重写「门禁 · 严重 N」（`iw-chip-error`），否则写「门禁 · 警告 M」（`iw-chip-warn`）。数字在 `<b>` 里。芯片 `title` 仍是两档都写的那句。点击走既有 `openLint`，打开 `LintReader`。不滚动到该卡的分组。
4. **不画的地方。** 待确认清单、待确认草稿、检索命中都不加色点。建议不出现在树行或这枚芯片上。

## Alternatives considered

- **行内数字徽标** —— 落选：30px 行是拿来扫的，数字会把状态挤出 320px 的树栏。色点只表示有没有、以及更严重的那一档；条数在 `title`。
- **建议也画点** —— 落选：建议是大库 findings 的大头。整棵树都是点就没有信号。状态条默认摘要同样不带建议。
- **库级 finding 在树顶或每一行打点** —— 落选：空 path 不属于任何一张卡。它仍只出现在质量门禁阅读器的库级组。
- **改行的 `title`，把条数接在概念后面** —— 落选：那条 `title` 已经是方案 A 的标题、概念和相关条数。色点自己带「严重 N · 警告 M」。
- **Host 先算好索引再下发** —— 落选：面板已经有 `findings`。这张表只为展示，不改契约。
- **待确认清单或草稿队列同步打点** —— 落选：B1 的队列行不在本轮。清单仍是卡型和置信度，草稿行仍是短种类。
- **点芯片后滚到该卡的 finding 分组** —— 落选：那要给 `openLint` 再传 path，并让 `LintReader` 挂载后把那一组滚进视口。本轮只打开现有阅读器；分组头已经能点开那张卡。
- **图标库** —— 落选：Client 单文件契约，[面板视觉一轮](2026-09-29-panel-visual-and-safety-pass.md) 也否过图标库。色点用与状态 chip `::before` 相同的 6px 圆。

## Consequences

- 换来：扫树时能看见哪张卡有严重或警告；打开卡片后，芯片写出更严重的那一档的条数，点击进入门禁阅读器。另一档的条数在色点和芯片的 `title` 里。
- 付出：有严重又有警告时，芯片正文不写警告条数。建议仍要进阅读器才看得见。库级问题不反映在任何树行上。
- 未做：滚到该 path 的分组、建议上树、待确认清单和草稿队列的色点、Host 改动。真机视觉验收仍是[既有缺口](../../TECH_DEBT.md#无浏览器真机验证)。本轮证据是 jsdom（`tests/panel.spec.tsx`、`tests/client-parts.spec.tsx`）。
- 树行的状态 meta 与行 `title` 仍由[卡片树与状态条方案 A](2026-11-02-tree-status-scheme-a.md) 约束。阅读器其余头区仍由[卡片阅读器方案 A](2026-11-02-card-reader-scheme-a.md) 约束。
