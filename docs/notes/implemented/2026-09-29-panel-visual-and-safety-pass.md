# Note: 面板视觉与安全一轮（亮色结构、行宽、层级、危险操作）

Status: implemented

## Problem

用户原话：「目前IP知识库的UI页面太简陋了，请调研类似插件，给出美化意见。」

三位专家（UI 设计师 / UI 视觉验收设计师 / 前端开发者）独立审了一遍面板代码，收敛到同一组可测结论；我自己复核了其中三条宿主级的论断，全部成立：

1. **亮色模式下面板几乎没有结构**。亮色 `--dsw-alias-bg-base`、`-bg-layer-1`、`-bg-layer-2` **同为 `rgb(255,255,255)`**（`design-platform.css:167,171,172`），而面板用 `bg-layer-2` 画悬停底、表头、按钮底 → 实测对比 **1.00:1**；控件轮廓用 `border-l1`（`rgba(0,0,0,.04)`）→ **1.09:1**。整套样式是照着暗色的可见性写的。
2. **状态色被当文字色用**：亮色 `state-warn` 2.15:1、`state-success` 2.28:1（我实算），而最需要被看见的「未确认 998」正是 warn 色，草稿差异预览的 ± 行也是这两色——差异预览是用户点「确认落库」前唯一要读的东西。
3. **标题层级塌成一档**：真库标题分布 h1 1262 / h2 5345 / h3 9832 / h4 1998 / h5 47（共 18,484 个），而 `markdown.tsx` 把 level≤2 与 level>2 都渲染成同一个 `.iw-md-h{font-size:14px}`。
4. **正文没有版心**：`.iw-read` 无 `max-width`，1920 宽窗下约 120 汉字/行；W3C clreq 的参考值是「横排最大行长不宜长于 48 字」。
5. **一段代码里没有任何焦点环**：全文只有 `.iw-input:focus { outline: none }`，唯一的焦点指示被自己抹掉了。
6. **危险操作与只读操作长得一模一样**：「作废」会丢弃草稿且不可回滚，却与「刷新」共用 `.iw-btn`；「全部确认」一键串行写 998 张卡，无二次确认、无进度，忙碌文案还是「正在读取…」（实测同类批次 52 秒）。而 `retry` 这个文案早就写好了却从没接线——错误态只有一个纯文本横幅。

另外纠正**我上一轮给三位专家的约束**：「可用令牌只有 14 个」是错的。那 14 个是 `BUILTIN_INSPECT_TOKENS`（`ui-theme/src/client/index.ts:131`，其 JSDoc 写明是 `ThemeRuntime.overrideTokens` 接受的名单），即**第三方主题可覆盖哪些令牌**，不是**插件可消费哪些令牌**。主题实际定义了 106 个唯一 alias 令牌，另有 `--dsw-radius-*`、`--dsw-font-*`、`--dsw-elevation-*`、`--dsw-focus-ring-*`；`docs/web-styling.md` 还**要求**组件用 `--dsw-alias-interactive-bg-hover`、`--dsw-alias-link`、`0.5px` 中性边框。本轮的样式因此按房规取令牌，而不是退化成灰阶。

## Decision

改动只落在 `src/client/`，**不动 Host/Client 契约、不引新依赖、不改宿主令牌**（改宿主令牌会污染其它面板）。

1. **中性填充改从墨水派生**：交互底用房规令牌 `--dsw-alias-interactive-bg-hover`（亮 6% / 暗 8%），其余中性面用 `color-mix(in srgb, var(--dsw-alias-label-primary) N%, transparent)`。`bg-layer-*` 在面板里不再作为填充使用。树栏与标题行改用 `--dsw-specific-sidebar-fill`（亮 `bluish-50`、暗 `bluish-900`），这是唯一在两套配色里都区别于底色的中性面，于是亮色下两栏也有了分界。
2. **色相只留给状态**：状态 chip 不再用状态色作文字色，改为「中性底 + 状态色圆点」（`::before`，6px），文字回到 `label-primary`；`warn`/`success` 只在圆点、`border-*color` 与整行 `background` 洗色上出现。门禁 `suggestion` 档原用 `state-idle`（白底 1.47:1），改为 `border-l2`。差异预览的 ± 行改成「主色文字 + 同色 12% 行底」，方向由行首的 `+`/`-` 承担。
3. **版心**：`.iw-md` 的散文块（标题/段落/列表/引用）与卡片标题 `max-width: 40em`，表格与代码块不受限（各自横滚），`font: var(--dsw-font-markdown-base)` 让正文跟随客户端的内容字号偏好。
4. **层级**：卡片标题用 `--dsw-font-markdown-h1`（21px/30px/700，markdown 排版令牌是字重 600+ 的既定例外），正文 h1/h2/h3 分别用 `--dsw-font-markdown-h2`、`-h4` 与一个 13px/500 的次级档，DOM 上落在 h3/h4/h5。
5. **房规对齐**：中性边框 10 处 `1px → 0.5px`；字重 600 全部改 500；补 `:focus-visible` 环（`outline: 2px solid var(--dsw-alias-brand-primary)`，行内用负 offset）并删掉 `outline: none`；补 `a` 规则（`--dsw-alias-link` + 500 + hover 点线）；删掉中文上的 `letter-spacing` 与 `text-transform: uppercase`；字阶收敛为 11/12/13/20；（树行）定高 30px 单行 + 2px 行距，标题省略并挂 `title`；`pre`/diff 用 `--ds-font-family-code`。
6. **树的扫描成本**：树行从两行（约 45px）改单行 30px，1,137 行的滚动长度约 −34%。虚拟列表**不做**：它会打翻现有断言、jsdom 无 `IntersectionObserver`、且要引依赖。
7. **三处安全/可用**（用户从方案里选的三项）：
   - **按钮分四档**：`.iw-btn`（写但不销毁）、`.iw-btn-quiet`（读/导航：无底、次级墨）、`.iw-btn-primary`（落库）、`.iw-btn-danger`（作废/回滚）。「作废」与「刷新」从此不可能被认错。
   - **批量确认先问后写**：按钮带数量（`全部确认（998）`），点击只展开确认行（「将逐张写入并各自备份，可整批回滚。继续？」+ 继续/取消），执行中状态条报 `正在落库 N/总数`。
   - **错误态接线 `retry`**：`.iw-error` 内加重试按钮，重跑三个读取（树/草稿/门禁），成功即清横幅。
8. **降级提示不再伪装成空态**：检索降级（冷启动必然发生）改用 `.iw-notice`（warn 描边 + 主色文字），不再复用 `.iw-empty` 的灰色小字。

## Alternatives considered

- **只加"设计感"（阴影、渐变、品牌色铺底、图标库）**——不做。这套令牌里 `--dsw-alias-brand-primary` 在亮色等于 `--dsw-alias-label-primary`（同为 `bluish-1000`），铺底就是黑底黑字；图标库进不了单文件 CJS（客户端只允许 `react`/`react-dom` 走模块表）；阴影会与房规的 `0.5px` 发丝线冲突（`docs/web-styling.md` 明说 elevated surface 用 elevation 阴影且 `border: 0`，两者不得配对）。
- **虚拟列表**——不做，理由见上；替代是后续可加 `content-visibility: auto`、`useMemo` 包住 `parseBlocks`、行组件 `memo`。
- **给中文正文加字号提升可读性**——不做。行长约束是按字数算的，加字号只会进一步压缩可视行数；提可读性靠限行宽。
- **加大超时/提高密度/状态色做实心徽标**——不做：前两者分别是"面板冻结 163 秒"和"从 71 屏变 94 屏"，实心徽标会让 998 张未确认卡变成一片暖色（报警疲劳）。
- **改宿主令牌修对比度**——不做，理由同上；面板内改用法即可。
- **默认全折叠 / 待确认清单折叠 / 标题过滤 / 密度开关 / TOC / 互链可点**——本轮不做（B 档）。其中「`relatedConcepts` 只显示一个数字、正文 `[[双链]]` 点了没反应」是已知的**能力空缺**：全库有 3,499 条互链，而"不用再打开 Obsidian"正是这个面板的立项理由，列为下一步。
- **卡片标题与正文首个 `#` 标题重复渲染**（1,262 个一层标题里绝大多数就是卡片标题本身）——本轮不做，同样列 B 档。

## Consequences

- `pnpm run check` 全绿：typecheck、oxlint `--deny-warnings`、**497 通过 / 7 跳过**、`src/**` 每文件四项 100%。
- 五条负控制都真变红（每条都先备份、跑完逐字节还原）：
  1. 悬停底改回 `bg-layer-2` → `keeps neutral fills visible in light mode` 红；
  2. 把状态色写回 chip 文字色（**用原缺陷的同一种写法做变异**）→ 状态色那条红；
  3. `outline` 改回 `none` → 焦点那条红；
  4. 「全部确认」直连 `confirmAll`（去掉二次确认）→ `asks before a batch writes anything` 红；
  5. 二级标题塌回一级 → 面板标题分档那条红。
  另删掉 `.iw-btn-danger` 变体 → 按钮分档那条红。
  第 2 条第一次写成了按行首锚定的正则，**变异没变红**：回头用同一把尺子量原始缺陷代码也量不出来，属假门禁。改成"先剥离 `border-*color` 声明再断言状态色不作为文字色"后才真正有牙。
- **尚未做真机视觉验收**（[TECH_DEBT 的既有缺口](../../TECH_DEBT.md#无浏览器真机验证)）：以上对比度、行宽与行高都是按令牌取值与代码算出来的，没有在真实浏览器里截图核对。验收表见本笔记的会话记录，要点：亮/暗各一遍、1440px 与 1024px 两档、1,137 张真库、键盘 Tab 走一遍、危险操作用库副本演练。
- 后续（2026-11-02）：检索进行中不再复用 `.iw-empty`，见[检索结果方案 A](2026-11-02-search-results-scheme-a.md)。
