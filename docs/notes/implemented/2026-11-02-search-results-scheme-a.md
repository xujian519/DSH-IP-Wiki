# Note: 检索结果方案 A

Status: implemented

## Problem

检索命中画在 `.iw-row` 上，和 30px 的树行同一套皮肤。一行 meta 把卡型、域、命中级别和三位小数的分数串在一起，`SearchHit.status` 根本不画。出处是另一行 meta，长路径一直摊开。左栏只有 320px，一条命中要读的东西被排成了树行的加长版。检索进行中用的是 `.iw-empty`，和「没有命中」「卡片目录为空」同一套居中灰字；降级提示已经因为这个原因改成了 `.iw-notice`，进行中却还穿着空态的衣服。结果态里标题筛选是 `disabled` 加 0.55 透明度，框旁没有字，停用看起来像控件坏了。

## Decision

只改检索结果这一段（`HitRow`、滚动区里的进行中提示、钉头里标题筛选的停用说明）。文件是 `src/client/IpWikiPage.tsx`、`src/client/styles.ts`、`src/client/locales.ts`。右栏 `CardReader` 不动。Host 检索算法、`SEARCH_LIMIT`（10）不动。不引依赖，Client 仍是单文件。钉头双框和「结果只替换 `.iw-tree-scroll`」保持[卡片树与状态条方案 A](2026-11-02-tree-status-scheme-a.md)。

1. **命中是独立的卡，不复用 `.iw-row`。** `.iw-hit` 有 0.5px 边框、12px 圆角、从墨水派生的填充。打开卡片的是里面的 `button.iw-hit-open`（标题、状态、分层、级别、片段都在按钮里）。选中用 `.iw-hit[data-selected='true']` 的内边条，不借用 `.iw-row-selected`。
2. **卡上的事实分开排。** 标题在左，分数在右，`toFixed(1)`（`0.87` 显示为 `0.9`），文案仍是 `score`。状态单独一行，文字是 `status` 加 `statusText`，三种状态都画；6px 状态点上，草稿和已废弃用 warn，已确认用 success，文字保持主色。卡型是 `.iw-hit-type`，域是其下缩进 12px 的 `.iw-hit-domain`，不再写成 `卡型 · 域`。命中级别（`matched` 经 `modeLabel`，用 ` + ` 连接）单独一行。片段是 `.iw-hit-snippet`。
3. **出处可折，默认收起。** 有法条或来源路径时才渲染 `details.iw-hit-source`，不带 `open`。摘要是 `provenance`，展开后才是法条和来源路径，中间用 ` · `。`details` 放在按钮外面：折叠控件不能放进按钮。没有出处时不渲染这块，面板上也不出现「出处」。
4. **进行中用 `.iw-searching`。** 左对齐、主色、`0.5px` 虚线框，不用 `.iw-empty` 的居中灰字。没有命中仍用 `.iw-empty`；降级原因仍用 `.iw-notice`（[面板视觉一轮](2026-09-29-panel-visual-and-safety-pass.md)）。
5. **结果态筛选旁写明不可用。** `submitted !== ''` 时筛选框仍 `disabled`，旁边是 `filterUnavailable`：「结果中不可用」/ `Unavailable in results`。词还留在框里，点「返回卡片树」后按原词继续滤。钉头仍是两个框（提问检索、筛选标题），结果列表只出现在 `.iw-tree-scroll`。

## Alternatives considered

- **结果顶栏方案 B** —— 用户确认本轮只做方案 A。方案 B 是给结果另做一条顶栏，把级别、扫描数、废弃数、近似重复从滚动区的节标题里挪走。那是另一套顶栏，本轮不引入；这些数仍留在 `.iw-tree-scroll` 的节标题上。
- **只在 `.iw-row` 上补状态并把分数改成一位小数** —— 落选：树行皮肤是 30px 扫描行，片段和出处会把命中拉成一条看不清层次的加长行。卡型和域继续挤在同一行 meta 里，分层做不到。
- **出处默认展开** —— 落选：来源路径在 320px 里会盖住片段。默认收起，要核对引用时再展开；没有出处则整块不出现。
- **进行中继续用 `.iw-empty`** —— 落选：和降级提示不穿空态的衣服是同一条。进行中不是空列表。
- **结果态拿掉标题筛选框** —— 落选：树方案 A 已经把两个框钉在钉头。拿掉会让结果态的钉头变成单框，返回树时筛选框再出现。停用并写明原因，框留着。
- **改 `SEARCH_LIMIT`、虚拟列表、改 Host 排序** —— 用户确认不做。虚拟列表会打翻 jsdom 断言并要新依赖，单文件 Client 契约也不允许。

## Consequences

- 换来：一条命中能分开读到标题、状态、卡型、域、片段和一位小数的分数；出处默认不占行，展开仍能核对法条和来源路径。检索进行中和空列表不再长得一样。结果态里能看见标题筛选为什么不能用。
- 付出：命中卡比 30px 树行高，一次检索的十张（`SEARCH_LIMIT`）比以前占更多滚动。分数从三位小数收成一位，`0.87` 与 `0.91` 都显示成 `0.9`。
- 未做：结果顶栏方案 B、右栏阅读器、Host 检索算法、改 `SEARCH_LIMIT`、新依赖、虚拟列表。真机视觉验收仍是[既有缺口](../../TECH_DEBT.md#无浏览器真机验证)。本轮证据是 jsdom（`tests/panel.spec.tsx`、`tests/client-parts.spec.tsx`）；这个仓库不起独立的面板页面。
