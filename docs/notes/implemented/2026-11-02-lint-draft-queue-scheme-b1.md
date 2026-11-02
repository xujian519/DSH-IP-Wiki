# Note: 待确认草稿与门禁分组方案 B1

Status: implemented

## Problem

「待确认草稿」每一行把目标路径、`classification` 和 `policy` 铺在标题旁边。树行已经收成 30px、行内只留状态，这一节仍是两截信息，扫队列时先读到路径而不是标题。质量门禁阅读器按 critical / warning / suggestion 分档：同一张卡的问题散在三档里，带路径的 finding 各自是按钮，空 path 的库级 finding 夹在档内。看过一组之后没有办法在这一次打开里把它收起来；报告刷新后，已经不存在的 path 也不该继续占着「看过」。

## Decision

只改左栏「待确认草稿」行和右栏 `LintReader`（`src/client/IpWikiPage.tsx`、`src/client/styles.ts`、`src/client/locales.ts`）。状态条门禁 chip、左栏门禁行、`refreshLint` 的时机保持[面板方案 A](2026-11-02-lint-draft-hints-scheme-a.md)。不引依赖，Client 仍是单文件。不写 Host，不落盘。

1. **队列行只留标题和短种类。** 可见内容是标题（空标题仍退回 `target`）加一枚中性 chip：`卡` / `合并` / `状态`（英文 Card / Merge / Status），对应 `kind` 的 `card` / `merge` / `status`。原先行内的 `target · classification · policy` 放进该行的 `title`，悬停可见。行仍是 `.iw-row-line`（`min-height: 30px`），chip 用 `.iw-row-line > .iw-chip { flex: none }`，标题继续截断。这一节的标题仍是「待确认草稿」；卡片生命周期仍是「草稿」。两者不合并。
2. **门禁按 path 分组。** 组头是路径（按钮，点击走既有 `openCard`）加上计数。计数用状态条已有的 `lintStripCritical` / `lintStripWarning`，以及 `lintSuggestion`；为零的档不写。空 path 合成一组，排在所有卡片组之后，标题是已有的 `lintLibraryWide`（「库级」/ library），是 `span`，不导航。组内仍按档折叠：critical 与 warning 默认展开，suggestion 默认收起。没有 finding 的档不渲染。finding 本身只留档、规则名和消息，不再重复路径，也不再各自是按钮。
3. **「已阅」只在这次 `LibraryPanel` 挂载里。** `lintRead` 是 `Set<string>`，键是 path，库级用空字符串。组头按钮在「已阅」和「取消已阅」之间切换（英文 Mark read / Unmark）。已阅的组是 `.iw-lint-group[data-read='true']`（次级色），并且默认收起；组头的折叠按钮仍能展开。标记记在面板上，所以离开阅读器再回来还在。整页面板卸载再挂上则清空。`lint` 换成新报告时，只丢掉报告里已经没有的键。

## Alternatives considered

- **方案 B2：树行或卡头逐卡徽标** —— 落选：和生命周期状态（草稿 / 已确认 / 已废弃）挤在同一行。本轮只做队列密度和阅读器分组。
- **把「已阅」写进 Host 或磁盘** —— 落选：那是「这条别再报」的持久忽略，会变成新的写入面。本轮的标记不改变 `LintReport`。
- **已阅的组不能再展开** —— 落选：标记是「这组先收起」，不是把 finding 从报告里拿掉。组头仍可展开。
- **把待确认队列并进卡片树里 `status: draft` 的那些行** —— 落选：一个是还没落库的写入队列，一个是已经在库里的生命周期。名字保持「待确认草稿」和「草稿」。
- **种类 chip 继续用「状态确认」全文** —— 落选：30px 行里放不下。短词是「状态」，全文留在阅读器。

## Consequences

- 换来：队列行靠近树的 30px；同一张卡的 findings 在一组里；库级单独垫底且点不了；这一次打开里可以把看过的组收起、淡化。报告刷新后，还在的 path 保持已阅，消失的 path 不再占标记。
- 付出：路径、分级和策略要悬停才看得见。finding 不再各自打开卡片，打开卡片只在组头。已阅在面板重挂后丢失，也不跨会话。
- 树行色点与卡头芯片见[门禁色点方案 B2-A](2026-11-02-lint-badge-scheme-b2-a.md)。未做：Host 忽略、failOn 切换、编辑器脏状态、重命名「待确认草稿」或「草稿」。真机视觉验收仍是[既有缺口](../../TECH_DEBT.md#无浏览器真机验证)。本轮证据是 jsdom（`tests/panel.spec.tsx`、`tests/client-parts.spec.tsx`）。
- 后续（2026-11-02）：右栏草稿阅读器的标题行、种类芯片、将弃用列表和作废确认见[草稿阅读器方案 A](2026-11-02-draft-reader-scheme-a.md)。队列行的短种类不变。
