# Note: 工具的 output.schema 必须描述 execute 的返回值

Status: implemented

## Problem

`ip_wiki_search` / `ip_wiki_get` / `ip_wiki_cite` / `ip_wiki_draft` / `ip_wiki_lint` 五个工具的 `output.schema` 声明 `{ text: string }`，而 `execute` 返回的是富对象（`SearchResult` / `CardDocument` / `CiteVerdict` / `DraftView` / `LintReport`）。DSH 的工具注册表在 render **之前**用 `validateJsonSchemaValue(tool.output.schema, value)` 校验（`packages/core/tools/src/index.ts:1806`），于是这五个工具在真机上**每次调用都失败**：

```
tool "ip_wiki_lint" returned invalid output: missing required property "value.text"
```

为什么 P1–P3 的验收没抓到：那些 eval 直接调 `tool.execute(...)` 再调 `tool.output.render(...)`，**从不经过注册表**；`host-entry.spec.ts` 只断言注册发生（`tools.map(tool => tool.name)`），不执行任何工具。也就是说"P1/P2/P3 全部通过"这条结论的证据链缺了 dispatch 这一环——是用户在真机上让我跑一次 `ip_wiki_lint` 才暴露的。

## Decision

1. **`execute` 只返回声明的那一个值**：七个工具统一用 `TEXT_OUTPUT`（`{ text: string }` + 渲染成单个文本块），`execute` 在体内调用既有渲染函数并返回 `{ text }`。模型看到的值就是被校验、被冻存、被投影的值。
2. **顺带删掉 `ip_wiki_review` 超出的键**：它返回 `{ action, id, text }`，而 schema 只声明 `text`；现在只剩 `text`。
3. **补一条走真实契约的测试**：`the model-facing tool contract` 对七个工具各发一次有效调用，断言 `output.schema` 恰为 `{text}`、返回值**只有** `text` 一个键、`render` 的输出等于该文本。负控制已做：把 `ip_wiki_lint` 改回返回 `LintReport`，该测试立刻变红（`expected ['scanned','findings',…] to deeply equal ['text']`），恢复后转绿。

## Alternatives considered

- **为五个结果类型各写一份完整 JSON Schema** — 落选：等于把五个类型再写一遍，改结果形状就要同步五处；模型只需要文本，面板也不经工具读数据。
- **保留富返回值、只修 schema** — 落选：同上，且 `assertSupportedJsonSchema` 限制可用的 schema 特性。
- **在 `render` 里兼容两种形状** — 落选：注册表在 render 之前就拒绝了，兼容 render 救不了 dispatch。
- **不改，文档里写明"工具仅供内部调用"** — 落选：等于承认插件对模型不可用。

## Consequences

- 换来：七个工具第一次真正可被模型调用（重启后实测确认）；契约测试把"声明 = 返回值"钉在门禁里。
- 付出：工具结果是纯文本，结构化结果不进会话日志（此前也没进——调用是失败的）。
- 教训（同时写进[测试规范](../../testing.md#验收证据必须走真实入口)）：**"`execute` 能跑通"不等于"工具能被调用"**；验收证据必须包含一次走注册表/真实入口的调用。
