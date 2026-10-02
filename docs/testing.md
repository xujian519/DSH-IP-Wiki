# 测试与证据规范

门禁与命令归 [development.md](development.md)；这一篇写**什么算证据**、以及门禁自己怎么被证明。

## 门禁的灵魂是负控制

> 会误报或空转的门禁比没有更糟——它读起来像保护，实际什么都没拦。

每道门禁都有一份**必须变红**的证明，放在 `tests/gates/`，用项目自己的配置与真实入口跑：

| 证明 | 断言什么 |
|---|---|
| `typecheck-contract.spec.ts` | 五个严格开关全为 true；`include` 覆盖 `src` 与 `tests` |
| `lint-contract.spec.ts` | 用**项目自己的配置**跑 `tests/gates/fixtures/` 的三份坏代码，必须非零退出且报出对应规则；三条规则在配置里必须是 error；同一套参数跑 `src` 必须是 0 error |
| `coverage-contract.spec.ts` | `perFile` 为 true 且四项阈值都是 100；`include` 未被收窄；`check` 仍串起三个代码门禁 |
| `docs-links.spec.ts` | 中间那段的坏链接 fixture 必须被逐条点名；同一把尺子量真实的 `AGENTS.md` / `README.md` / `docs/**` 必须是 0 问题 |
| `notes.spec.ts` | 坏的决策记录 fixture 必须被逐条点名（目录、`Status`、骨架四段、Alternatives 非空）；真实的 `docs/notes/**` 必须 0 问题 |
| `library-lint-gate.spec.ts` | 库质量门禁在注入的孤立卡 / 断链 / 索引漂移 / 被十张卡反复提到却没有卡的缺失目标 / 与其它域零互链的孤岛域上必须红；一个已经被现有卡回答的目标必须**不**出现在报告里，干净库必须绿（不是恒红的门禁） |
| `pipeline.spec.ts` | CI workflow 与本地钩子还在跑该跑的命令（只读声明不读注释）；变异副本必须被逐条点名 |

**改任何门禁时按三步走**：引入一个回归 → 确认它变红 → 回退。三步里最容易骗自己的是第二步——本项目已经踩过两次"控制脚本没改到目标、却报绿"：删除二次确认那条控制的匹配模式写的是 `onClick`，真实代码是 `onAskDelete`；面板状态色那条控制第一版按行首锚定的正则量不出原始缺陷。所以控制脚本要**自己断言变异真的落地**（比对改动前后的字节），变异不变红时先怀疑控制脚本，不要先怀疑门禁。

## 覆盖率：每个文件 100%

`pnpm run test:coverage` 由 vitest 自己的 `thresholds` 判定，`perFile: true`，四项 100。没有地板表、没有豁免名单；`include` 只含 `src/**`，收窄它就是藏文件。

判定思路**不是**「补测试凑数字」，而是：

- 未覆盖的行**先当作死代码**。本项目的 100% 一趟里，按此删改掉的分支包括：`markdown.tsx` 里不可达的链接回退（改为按分隔符切片）、`parseFrontmatter` 里越界索引的 `?? ''`（改为整体正则开栏 + `entries()` 遍历）、`library.ts` 里对常量路径的越界判断（改走 `inside()`）、`routes.ts` 里重复请求头的数组分支（改为 `String()`，落白名单之外即拒绝）、`byCountDescending` 里恒存在的 `?? 0`。
- **不可达的状态组合要让类型系统排除**：待确认清单的卡片必然带 `confidence`，于是引入 `ReviewCard`（`confidence: number`）而不是让每个消费者防守 `undefined`；`problem` 改为必填字符串（可读时为空串）而不是 `string | undefined`。
- 确实需要防守的分支（如 `req.method === undefined`、`url === undefined`、越界索引）就补一条**走真实入口**的测试让它可达。
- 一处**真实缺陷**由测试逼出来：非表格的 `|` 行会让段落分支原地死循环（vitest 直接 OOM）。`parseBlocks` 因此重写为「段落首行必然消费」的形式。

## 测试哲学

1. **真实现优先**：只 mock 昂贵 / 非确定边界（`fetch`），其余保持真实——`tests/routes.spec.ts` 起的是真 HTTP 服务器，`tests/library.spec.ts` 写的是真临时目录。
2. **测真实入口**：路由打真 socket，`apply()` 走 stub composition，组件交互走真实 DOM 事件与真实 `fetch` 替身。
3. **验证世界，不是自述**：断言磁盘上读回来的内容、HTTP 状态的字节、注册表里收到的席位，而不是被测对象说它成功了。
4. **桩要与真身同形**：面板的 API 替身必须能触发父组件状态、必须按路径分支返回，否则「点了一张卡却显示另一张」这类错会全绿（本项目就踩到过一次）。

## 验收证据必须走真实入口

P1–P3 的 eval 直接调 `tool.execute()` + `tool.output.render()`，绕过了注册表，于是五个工具的 `output.schema` 与返回值不符这件事一直没被发现——真机上每次调用都 `INVALID_TOOL_OUTPUT`（决策记录：[工具输出契约](notes/implemented/2026-09-29-tool-output-contract.md)）。现在 `tests/tools.spec.ts` 的 `the model-facing tool contract` 走"声明 = 返回值"契约并有负控制。

**新增或修改任何智能体工具时，必须有一条经注册表语义（schema + 返回值一致）的测试**，否则 `execute` 跑通不算数。

## 破坏性验证的规矩

删除、批量弃用、覆盖真库文件这类验证**只对副本或临时目录跑**，永不对库根跑；确实需要对真库根动手之前先按时间戳快照 `raw/snapshots/`。这条是被一次真事故写进来的：一次破坏性负控制把控制脚本跑在了真实库根上，删掉一张真卡并剥掉一条反链，两处都从 `.dsh-ip-wiki/archive/` 里的确认草稿按字节写回（[事故记录](TECH_DEBT.md#删除在真库上意外演练过一次)）。
