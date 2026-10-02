# Note: P0 面板只读、真源在磁盘、守卫头共用一份常量

Status: implemented

## Problem

卡片库已落盘，但要在 Harness 里看它，原先只能去 Obsidian 或文件管理器。P0 要在 Harness 内给出一块能读卡片的屏幕，同时不能因为「顺手」而让插件改写用户的库，也不能让面板显示一份已经过期的派生索引。

## Decision

1. **面板只读**：Host 只注册 `GET /dsh-ip-wiki/{status,tree,card,reports,report}`，非 GET 一律 405；Client 只发读请求。写入面（草稿、合并、打标）整体留到 P2。
2. **真源是 `cards/` 下的文件**：面板每次扫盘，`index/card-index.json` 只用来交叉核对，漂移在状态条上显式呈现（`none` / `missing` / `count-mismatch` / `unreadable`），而不是把索引当数据源。
3. **守卫头与前缀共用一份常量**（`src/shared/wire.ts`）：Host 路由与 Client 请求都从这里取。两侧各写一份就是必然漂移的缝。路由校验 `x-dsh-ip-wiki` 请求头，并在浏览器送 `Sec-Fetch-Site` 时只接受 `same-origin` / `none`。
4. **路径不外泄**：调用方给的路径经 `resolveInside()` 判包含；库自身目录名经 `inside()` 常量拼接。
5. **线上边界逐字段读入**（`shared/parse.ts`），缺判别字段即抛错点名。
6. **不可达的状态组合交给类型系统**：待确认卡片用 `ReviewCard`（`confidence: number`），`problem` 为必填字符串。

## Alternatives considered

- **用 `index/card-index.json` 作为面板数据源** — 落选：索引是派生件，一旦过期面板就会显示错数据；改为扫盘 + 漂移提示，索引过期变成一条可见的状态，而不是一次静默的错误读取。
- **把守卫头常量在两半各自声明** — 落选：两条声明之间没有任何东西保证一致，漂移后表现为「面板永远 403」或更糟的静默放行。
- **让 Client 把 JSON 断言成 `LibraryTree`** — 落选：线上载荷是本包自己的产物，但断言把「Host 改了字段名」的后果推给渲染层（空白面板）；逐字段读入把错误变成一句点名的话。
- **面板首期就支持写入（草稿 + 确认）** — 落选：人在环门禁要配 diff 预览与可回滚语义，属于 P2；P0 先把「读得到」做实并让原文零改动可验证。
- **把面板做成右侧栏文档预览器（`sidebar.right.tab.document`）** — 落选：卡片库不是「一个文件」，它是树 + 阅读 + 报告三个面；主面板席位（与「工作台」同一套 `sidebar.panellist` + `main` 机制）才放得下，且不依赖 better-sidebar（该插件在 desktop profile 里是禁用的）。

## Consequences

- 换来：原文零改动（面板不可能写库）、索引过期可见、两侧契约不可能漂移、缺少判别字段时报错点名。
- 付出：面板每次进入都扫盘（当前 30 张可忽略，1235 张量级需要加缓存，属后续工作）；只读意味着 P0 只能「看」，整理动作仍要等 P2。
