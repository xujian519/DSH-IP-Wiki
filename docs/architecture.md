# 架构

改任何代码之前先读这一篇。它只写**约束**——不可违反、违反了就会被构建或测试拦下的部分；功能、配置、库目录约定归 [README](../README.md)，怎么跑门禁归 [development.md](development.md)。

## 一个 npm 包，两个半边

| 半边 | 入口 | 产物 | 运行环境 |
|---|---|---|---|
| Host | `src/index.ts` | `lib/index.js`（ESM） | Node：注册 `/dsh-ip-wiki/*` 路由（读：库读取 / 检索 / 质量门禁；写：草稿确认 / 作废 / 回滚 / 索引重建 / **卡片永久删除**）+ 七个智能体工具（检索三件套 / 门禁 / 草稿 / 确认入库 / 裁决）+ 智能体系统提示段 |
| Client | `src/client/index.tsx` | `lib/client.js`（单文件 CJS） | 浏览器：注册侧边栏入口与主面板 |

`src/shared/` 是两半共用的纯逻辑：卡片与状态类型（`card.ts`）、frontmatter 解析（`frontmatter.ts`）、线上载荷校验（`parse.ts`）、守卫头与前缀（`wire.ts`）。

## 不可违反的架构约束

1. **Client 半边必须符合 DSH 动态客户端契约**：单文件 CJS；唯一副作用是 `window.__ModuleLoader__.load({id, factory})`；只允许 `react` / `react/jsx-runtime` / `react-dom` / `react-dom/client` 走 shell 的模块表，其余依赖全部内联。构建期由 `tsdown.config.ts` 的 `client-shape` 插件拦截：出现兄弟文件或同步 `require('./x.js')` 即构建失败。
2. **守卫头与前缀只有一个家**：`src/shared/wire.ts`。Host 路由与 Client 请求都从这里取，两侧各写一份副本就是一条必然漂移的缝。
3. **路由自带守卫**：`/api` 之外的路径必须校验 `x-dsh-ip-wiki` 请求头（跨源表单/图片请求设不了它），并在浏览器送 `Sec-Fetch-Site` 时只接受 `same-origin` / `none`；重复头按拒绝处理（`String(site)` 落到两个白名单值之外）。
4. **写入面只有五条 POST，其中四条可回滚**。读路由只答 GET；写路由只有 `/draft/confirm`、`/draft/discard`、`/draft/revert`、`/index/rebuild`、`/card/delete`。草稿只落 `.dsh-ip-wiki/`；`cards/` 被 `confirmDraft` 写（有备份）与 `deleteCard` 删（**无备份、不可回滚**）；`index/card-index.json` 只由 `rebuildIndex` 写（`confirmDraft`/`deleteCard` 写完后自动重建，且**重建前把旧索引字节并入这次草稿的备份**，于是 `revertDraft` 把旧字节放回去而不是再重建一次——confirm→revert 因此逐字节复原，有真库哈希证据）。备份在 `.dsh-ip-wiki/backups/<id>/`。不写 `raw/`；检索的关键词索引与向量缓存只在进程内存里。
   **`/card/delete` 是唯一不可撤销的操作**：只接受 `cards/**/*.md`（`..`、reports/、index/ 一律拒绝），**先清掉其它卡里指向它的 `related_concepts`（按 id 与 `from_id` 匹配，与门禁同一口径），最后才删文件**——中途失败留下的是可重跑的"关联少了几条"，不是悬空引用；**文件删掉之后、索引重建之前写一行审计**（`delete <path> <n> references stripped`）：它是唯一不留备份的写，也就最需要留痕。面板侧是 danger 变体 + 二次确认行；**不给模型工具**（永久删除需要人工复核点）。决策记录：[B 档面板与删除](notes/implemented/2026-09-29-panel-b-tier-and-card-deletion.md)、[删除审计线](notes/implemented/2026-09-29-delete-audit-line.md)。
   **写卡片的入口只有两个，且都只生成草稿**：`ip_wiki_draft`（新卡 / 合并）与 `ip_wiki_confirm`（把已入库但仍是 `status: draft` 的卡提交为状态确认草稿）。**批量脚本直写 `cards/` 是违规的**：真库 130 张卡就是这么进来的，补救即 `ip_wiki_confirm` 全库排队 + 面板确认（决策记录：[状态确认](notes/implemented/2026-09-29-card-status-confirmation.md)）。
5. **路径不外泄**：调用方给的路径一律经 `resolveInside()` 判定包含关系；库自身的目录名走 `inside()`（常量拼接，不可能越界）。这条有测试钉住（`../`、绝对路径、同名前缀兄弟目录）。
6. **线上边界必须校验**：Client 不把 JSON 断言成类型，而是逐字段读入（`shared/parse.ts`）；缺少判别字段就抛错并**点名是哪一段**，而不是渲染空白面板。
7. **注册即效应**：一切注册走 `ctx.effect()`；两半都把自己的协作者当硬依赖，缺任何一个就抛 `missingService()`，绝不静默挂半个插件。
8. **真源是磁盘上的卡片**：`index/card-index.json` 只作交叉核对（漂移要显示出来），不是读取来源。
9. **凭据不入库、不进仓库**：本地嵌入端点的 key 只从库根之外的本地配置读（`embedding.apiKeyFile`，默认 `~/.dsh/ip-wiki/config.json`，0600，内容 `{"apiKey":"…"}`）；读不到只降级成关键词检索、不报错，也绝不把它写进卡片库、本仓库或日志。

## 这些约束的代价记在哪

每一条约束的取舍与放弃的备选都在它的决策记录里；`docs/notes/implemented/` 是那些记录的家（[写法](notes/README.md)）。约束改了，记录跟着改或另写一条——别让记录停在旧决策上。
