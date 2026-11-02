# Note: 卡片树与状态条方案 A

Status: implemented

## Problem

顶栏状态条把卡片总数、每一种卡型的计数、未确认、已确认、索引生成时间、漂移、整理报告数、待审数铺在同一行。卡型一多，这一行就换行，库健不健康被分项计数淹没。左栏 `nav.iw-tree` 整栏滚动：语义检索和标题筛选跟着树一起滚走，要换一个问题或收窄标题时得先滚回顶部。树行虽然已经是 30px 单行，meta 仍把状态、概念和「相关 N」挤在标题旁边，长概念把状态顶出可视区。两个输入框的占位都像一段说明，看不出一个是在问库、一个是在滤当前这棵树。

## Decision

只改顶栏 `StatusStrip` 和左栏 `nav.iw-tree` 的导航（`src/client/IpWikiPage.tsx`、`src/client/styles.ts`、`src/client/locales.ts`）。右栏 `CardReader` 保持[卡片阅读器方案 A](2026-11-02-card-reader-scheme-a.md)。不引依赖，Client 仍是单文件。

1. **状态条两档**。默认一行只留卡片总数、未确认（`draft` 计数大于 0 才出现）、索引漂移（`driftOf` 的四档文案）、待审（`needsReview` 非空才出现，文案是 `reviewStrip`：待审 / Review；左栏节标题仍用 `reviewQueue`）。「详情」是同一条里的按钮（`statusDetails`：详情 / Details），`aria-expanded` 控制 `.iw-status-extra`。展开后才是卡型分项、整理报告数、已确认数、索引生成时间（没有索引时仍是「无索引」）。`.iw-status-extra[hidden] { display: none }` 单独写，避免 `display: flex` 盖过 `[hidden]`。
2. **左栏钉检索和筛选**。`nav.iw-tree` 改成纵向 flex、`overflow: hidden`、`min-height: 0`。`.iw-tree-pin` 固定「提问检索」和「筛选标题（本树）」；`.iw-tree-scroll` 才 `overflow-y: auto`，里面是草稿、门禁、待审、卡片树、报告。检索结果仍替换滚动区里的树，两个框留在钉头。筛选只作用于本树标题，结果态把它 `disabled`，点「返回卡片树」后按原词继续滤。
3. **树行 meta 只留状态**。分组行和筛选命中行的 `.iw-row-meta` 都只渲染 `statusText`。概念与相关条数放进 `title`（`概念 三步法 · 相关卡片 2` 这种）。筛选命中丢掉了卡型分组，卡型也放进 `title`。`.iw-row-line` 的 `min-height: 30px` 不动。卡片树节标题在未筛选时带 `（N 组）`（`groups`）；整理报告节标题带份数，因为报告数已经不在状态条默认行。
4. **文案**。`searchPlaceholder` 为「提问检索」/ `Ask to search`。`filterPlaceholder` 为「筛选标题（本树）」/ `Filter titles (this tree)`。新文案都走 `locales.ts`。
5. **没动的约束**。无虚拟列表、无树宽拖拽、无密度开关。域分组默认收起，`Shift+X` 全展/全收保留。字重以 500 为主（`.iw-md-h3` 的 600 仍是阅读器那条的例外）。边框 0.5px，中性填充从墨水派生，chip 文字不着状态色。左树「全部确认」仍是单行 `.iw-confirm`，不套 `.iw-confirm-stack`。

## Alternatives considered

- **虚拟列表、树宽拖拽、密度开关** —— 用户确认本轮不做。虚拟列表会打翻现有 jsdom 断言，还要新依赖，单文件 Client 契约也不允许；拖拽和密度是另一套状态，这轮不引入。
- **默认行继续铺卡型分项和报告数** —— 落选：分项随卡型变长，正是这一行要收的原因。
- **从面板拿掉已确认数和索引生成时间** —— 落选：它们不属于默认四项，但[确认入库](2026-09-29-card-status-confirmation.md)仍要能看到已确认数，索引时间仍回答「什么时候生成的」。放进详情，不删除。
- **检索结果态连钉头一起换掉** —— 落选：提问框是换一个问题的入口，结果态仍要留着。标题筛选不作用在命中上，留着会像坏了，所以结果态停用，返回树之后恢复。
- **概念和相关条数留在行内 meta** —— 落选：30px 单行塞不下，悬停 `title` 仍能读到。

## Consequences

- 换来：状态条默认一行能扫完库的健康度；滚树时检索和筛选还在；行内只剩状态，概念和相关条数在悬停里。
- 付出：卡型分项、报告数、已确认数和索引时间要再点一次「详情」。检索结果态里标题筛选不可用，词还留着，回到树才生效。整理报告节标题带上了份数。
- 右栏阅读器、草稿确认的单行 `.iw-confirm`、域分组默认收起和 `Shift+X` 都不变。
- 未做：虚拟列表、树宽拖拽、密度开关。真机视觉验收仍是[既有缺口](../../TECH_DEBT.md#无浏览器真机验证)。本轮证据是 jsdom（`tests/panel.spec.tsx`、`tests/client-parts.spec.tsx`）；这个仓库不起独立的面板页面。
