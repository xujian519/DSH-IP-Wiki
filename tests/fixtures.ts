/** Shared fixtures: a throwaway card library on disk and the payload shapes the routes emit. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Frontmatter of a rule card, exercising every construct the parser supports. */
export const RULE_CARD = `---
id: "rule-1"
type: "rule"
title: "创造性判断的三步法"
domain_l1: "专利"
domain_l2: "OA 答复"
concept: "三步法"
related_concepts:
  - "old-1"
  - "old-2"
law_refs:
  - "专利法第 22 条第 3 款"
jurisdiction: "CN"
source:
  kind: "vault-card"
  path: "/vault/cards/rule-1.md"
  quote: "三步法"
  retrieved_at: "2026-09-29T18:52:51.675720+08:00"
quality: 0.92
confidence: 0.9
status: "confirmed"
needs_review: true
supersedes: []
version: 1
---

# 创造性判断的三步法

## 卡片内容

**第一步**：确定最接近的现有技术。

- 要点一
- 要点二

| 步骤 | 内容 |
| --- | --- |
| 1 | 最接近现有技术 |
| 2 | 区别特征 |

## 相关页面

- [[专利实务/创造性/三步法]]
`

/** Frontmatter of a concept card, minimal but valid. */
export const CONCEPT_CARD = `---
id: "concept-1"
type: "concept"
title: "什么是功能性特征"
domain_l2: "权利要求与说明书"
confidence: 0.62
---

# 什么是功能性特征

定义正文。
`

/** A Markdown file that is not a card, because it declares no known kind. */
export const NOT_A_CARD = `---
title: 随手记
---

这里没有卡型。
`

/** A report file, table-heavy the way the pilot reports are. */
export const REPORT = `# 试点映射报告

| # | 标题 | 建议卡型 | 置信 |
| --- | --- | --- | --- |
| 1 | 三步法 | rule | 高 |
| 2 | 功能性特征 | rule | 低 |
`

/** One throwaway library plus the paths inside it. */
export interface FixtureLibrary {
  /** Absolute library root. */
  readonly root: string
  /** Absolute path of the rule card. */
  readonly rulePath: string
  /** Absolute path of the concept card. */
  readonly conceptPath: string
  /** Absolute path of the report. */
  readonly reportPath: string
  /** Remove the whole tree. */
  readonly dispose: () => Promise<void>
}

/**
 * Write a throwaway library.
 * @param options - `indexTotal` sets the derived index's count; `omitIndex` leaves
 * the index out, and `indexText` writes it verbatim for the unreadable case.
 * @returns the fixture's paths.
 */
export async function makeLibrary(options: {
  indexTotal?: number
  omitIndex?: boolean
  indexText?: string
} = {}): Promise<FixtureLibrary> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ip-wiki-'))
  const cards = join(root, 'cards')
  await mkdir(join(cards, 'rule'), { recursive: true })
  await mkdir(join(cards, 'concept'), { recursive: true })
  await mkdir(join(root, 'reports'), { recursive: true })
  await mkdir(join(root, 'index'), { recursive: true })
  const rulePath = join(cards, 'rule', 'rule-1.md')
  const conceptPath = join(cards, 'concept', 'concept-1.md')
  const reportPath = join(root, 'reports', 'pilot-mapping.md')
  await writeFile(rulePath, RULE_CARD)
  await writeFile(conceptPath, CONCEPT_CARD)
  await writeFile(join(cards, 'notes.md'), NOT_A_CARD)
  await writeFile(reportPath, REPORT)
  if (options.omitIndex !== true) {
    const text = options.indexText ?? JSON.stringify({
      schema_version: 1,
      generated_at: '2026-09-29T18:52:51.675720+08:00',
      total_cards: options.indexTotal ?? 2,
    })
    await writeFile(join(root, 'index', 'card-index.json'), text)
  }
  return {
    root,
    rulePath,
    conceptPath,
    reportPath,
    dispose: async () => { await rm(root, { recursive: true, force: true }) },
  }
}
