# Note: 草稿阅读器方案 A

Status: implemented

## Problem

右栏 `DraftReader` 把「确认落库」和「作废」放在 `DiffView` 上面，差异还没读到就能落库。作废一击就调用 `discardDraft`，草稿进入 `archive/` 之后面板没有找回入口，却没有卡片删除那条二次确认。种类芯片只在合并和状态确认时出现，新卡草稿的头上看不出 `kind`。合并的「将弃用」用 `.iw-row*` 铺完整路径，和左树 30px 扫描行同一套语言，标题被路径盖住。头区事实若收成键值表，会把目标、策略、来源排成一张操作表。

## Decision

只改右栏 `DraftReader`（`src/client/IpWikiPage.tsx`、`src/client/styles.ts`、`src/client/locales.ts`）。左栏「待确认草稿」队列保持[待确认草稿与门禁分组方案 B1](2026-11-02-lint-draft-queue-scheme-b1.md)：短种类仍是 `draftKindCard` / `draftKindMerge` / `draftKindStatus`（卡 / 合并 / 状态，英文 Card / Merge / Status），行内仍不铺路径。Host、门禁阅读器、报告阅读器不动。不改「待确认草稿」这个名字。不做正文预览、目录、图标库。

1. **标题行**。`.iw-read-actions` 里 `h2` 在左、「作废」在右，仍是 `.iw-btn-danger`，`busy` 时 `disabled`。空标题仍退回 `target`。
2. **种类芯片在前**。`.iw-chip-kind` 放在 `.iw-meta.iw-draft-meta` 首位，字号 12px、主色、字重 500。`card` 用 `draftKindCard`；`merge` 用 `draftKindMerge` 加 ` · N`；`status` 用全文 `statusConfirm` 并加 `.iw-chip-warn`。卡型、目标、来源策略、来源、`willReplace` 或 `willCreate`、差异 `+N / -M` 仍是芯片。`.iw-draft-meta .iw-chip` 允许换行，种类芯片保持一行。不使用 `.iw-facts`。`local-only` 仍只染策略芯片。
3. **将弃用只在 `supersedes.length > 0` 时出现**。`.iw-supersedes` 与 `.iw-related`、`.iw-toc` 共用边框盒（`0.5px` 的 `border-l1`、圆角 12px、版心 `40em`）。标题是 `mergeAbsorb · N`。列表是纵向的 `.iw-supersedes-list`，按钮是 `.iw-wikilink.iw-wikilink-open`，不用 `.iw-row*`。可见文字是 `titlesByPath` 里的卡片标题；树上没有标题时用路径最后一段。`title` 悬停是完整路径。点击仍是 `onOpenCard`。说明仍是 `mergeNote`。
4. **顺序**。标题与芯片（作废确认条展开在芯片下方）→ 备注与来源 → 将弃用 → `DiffView` → 底部 `.iw-btn-primary`「确认落库」。确认按钮在差异之后。
5. **作废先问**。第一下只展开 `.iw-confirm.iw-confirm-stack`：问句是 `discardAsk`，继续是 `discardYes`（`.iw-btn-danger`，才调用 `onDiscard`），取消是 `cancel`。左树「全部确认」仍是单行 `.iw-confirm`，不套 `.iw-confirm-stack`。换一份草稿（`key` 为草稿 id）时确认条收起。

## Alternatives considered

- **把确认条的上下布局写进共用的 `.iw-confirm`** —— 落选：左树「全部确认」也用这个类。阅读器继续用[卡片阅读器方案 A](2026-11-02-card-reader-scheme-a.md) 的 `.iw-confirm-stack`。
- **将弃用仍用 `.iw-row`，只把路径换成标题** —— 落选：树行是 30px 扫描语言。阅读区要的是和相关卡片同一套边框列表。
- **头区改成 `.iw-facts` 键值表** —— 落选：目标、策略、来源要能扫，不是一张操作表。芯片保留，长路径在芯片内换行。
- **阅读器另起「卡片 / 新卡」文案** —— 落选：队列已经用 `draftKindCard` 与 `draftKindMerge`。状态确认的全文是 B1 留给阅读器的，短词「状态」留在队列。
- **作废保持一击即写** —— 落选：作废只进 `archive/`，面板没有找回。和删除一样，先问再写。
- **正文预览、目录、队列改版、Host、图标库、改名「待确认草稿」** —— 用户确认本轮不做。

## Consequences

- 换来：先看差异再点确认落库；作废要再点继续；将弃用能读到标题，完整路径在悬停；新卡草稿也有种类芯片。
- 付出：作废多一次点击。合并种类芯片不再带 warn 点，warn 留给状态确认和 `local-only` 策略。
- 未做：草稿正文预览、目录、左栏队列改动、Host。真机视觉验收仍是[既有缺口](../../TECH_DEBT.md#无浏览器真机验证)。本轮证据是 jsdom（`tests/panel.spec.tsx`、`tests/client-parts.spec.tsx`）；这个仓库不起独立的面板页面。
- 卡片阅读器的删除行与确认条是[卡片阅读器方案 A](2026-11-02-card-reader-scheme-a.md)。队列短种类是[待确认草稿与门禁分组方案 B1](2026-11-02-lint-draft-queue-scheme-b1.md)。
