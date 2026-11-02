# Note: 面板方案 A：状态条显示门禁摘要，带路径的 finding 打开卡片

Status: implemented

## Problem

质量门禁的结论只出现在左栏「质量门禁」一行和阅读器里。状态条报的是索引漂移、生命周期「未确认」和待审，不报 `LintReport` 的 `verdict`。`fetchLint('warning')` 在启动、重建索引和删除之后会再跑，但 `confirmSelection` 与 `confirmAll` 成功落库后只 `refresh` 加 `refreshDrafts`，状态条和左栏摘要停在落库前的报告上。左栏那一行用 ✅/❌，和状态条已经在用的色点 chip 不是同一套语言。带 `path` 的 finding 只把路径当文本；`path` 为空的库级 finding 没有卡片可打开。

## Decision

面板按方案 A 呈现门禁。Host 规则、`failOn`、树行与卡头都不加逐卡徽标。

1. `StatusStrip` 的默认档（`iw-status-main`）在 `lint` 非空时多一枚可点的色点 chip，不放进「详情」。色点沿用 [面板视觉与安全一轮](2026-09-29-panel-visual-and-safety-pass.md) 的 `iw-chip-ok` / `iw-chip-warn` / `iw-chip-error`，与检索命中的 `.iw-hit-status::before` 同一套状态色圆点。`verdict === 'pass'` 为 `iw-chip-ok`，文案「门禁通过」（英文 `Gate passed`）。`fail` 在 `counts.critical > 0` 时用 `iw-chip-error`，否则用 `iw-chip-warn`；文案是「门禁未通过 · 严重 N · 警告 M」，计数为 0 的档不写，suggestion 不进这条默认摘要。`lint === null`（还在读，或读取失败）不渲染这枚 chip。点击走与左栏同一条 `openLint`。
2. `LintReader` 里 `path !== ''` 的 finding 是按钮，点击走既有 `openCard`。`path === ''` 仍是不可点的「库级」。
3. 左栏「质量门禁」行去掉 ✅/❌，判定改用同一套色点 chip。短文案仍是「通过」/「未通过」，计数行仍含 suggestion。
4. `confirmSelection` 与 `confirmAll` 的成功路径在 `refresh` 与 `refreshDrafts` 之外再 `refreshLint`。批次中途失败不重读门禁，失败横幅仍只描述这次中断。

卡片生命周期仍叫「草稿」。写入队列仍叫「待确认草稿」。

## Alternatives considered

- **在树行或卡头加逐卡门禁徽标** —— 落选：和生命周期状态（草稿 / 已确认 / 已废弃）挤在同一行，两套「草稿」更难分。方案 A 只在状态条给一份库级摘要。
- **把门禁摘要放进状态条「详情」** —— 落选：默认档才是每屏都在的那一行。门禁过没过和索引漂移一样，不该等展开才看见。
- **`lint` 未返回时先放红色或「未通过」占位** —— 落选：读取中的空报告会被读成失败。chip 省略；左栏在报告到达前仍显示「正在读取…」。
- **默认摘要带上 suggestion 计数** —— 落选：suggestion 是大库报告的大头，放进每屏都在的状态条会把「未通过」淹没。计数留在左栏和阅读器。
- **库级 finding（`path: ''`）也做成按钮** —— 落选：没有可打开的卡。点了却不导航是假交互。
- **改 Host 规则、做 failOn 切换、finding 忽略持久化，或改「待确认草稿」的名字** —— 落选：都是另一项决策，不在方案 A。

## Consequences

- 换来：落库成功后门禁摘要跟着 `fetchLint('warning')` 更新；带路径的 finding 打开对应卡片；状态条与左栏用同一套色点。
- 付出：状态条多一枚 chip；带路径的 finding 是 `button.iw-finding`，库级 finding 仍是 `div`。
- 仍未做：逐卡门禁徽标、Host 规则改动、failOn 界面、finding 忽略持久化、面板内编辑的脏状态、重命名「待确认草稿」。确认批次中途失败时不刷新门禁。
