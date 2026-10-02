/** The library reader: what it reads off disk, and what it refuses to read. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  branchCards,
  countsOf,
  isAbsoluteRoot,
  listCards,
  listReports,
  readCard,
  readReport,
  readStatus,
  readTree,
  relativeTo,
  resolveInside,
} from '../src/host/library'
import { makeLibrary, type FixtureLibrary } from './fixtures'

/** Libraries created by the running test, removed afterwards. */
const created: FixtureLibrary[] = []

/**
 * Write a throwaway library and record it for cleanup.
 * @param options - fixture options.
 * @returns the fixture.
 */
async function library(options: Parameters<typeof makeLibrary>[0] = {}): Promise<FixtureLibrary> {
  const fixture = await makeLibrary(options)
  created.push(fixture)
  return fixture
}

afterEach(async () => {
  await Promise.all(created.splice(0).map(async fixture => { await fixture.dispose() }))
})

describe('resolveInside', () => {
  it('resolves a relative path under the root', () => {
    expect(resolveInside('/lib', 'cards/a.md')).toBe('/lib/cards/a.md')
  })

  it('accepts the root itself', () => {
    expect(resolveInside('/lib', '.')).toBe('/lib')
  })

  it('refuses a blank path', () => {
    expect(resolveInside('/lib', '   ')).toBeUndefined()
  })

  it('refuses a path that leaves the root', () => {
    expect(resolveInside('/lib', '../etc/passwd')).toBeUndefined()
  })

  it('refuses an absolute path', () => {
    expect(resolveInside('/lib', '/etc/passwd')).toBeUndefined()
  })

  it('refuses a sibling whose name starts with the root name', () => {
    expect(resolveInside('/lib', '../library/secret.md')).toBeUndefined()
  })
})

describe('relativeTo and isAbsoluteRoot', () => {
  it('normalizes separators to forward slashes', () => {
    expect(relativeTo('/lib', join('/lib', 'cards', 'a.md'))).toBe('cards/a.md')
  })

  it('recognizes an absolute path', () => {
    expect(isAbsoluteRoot('/lib')).toBe(true)
    expect(isAbsoluteRoot('lib')).toBe(false)
  })
})

describe('listCards', () => {
  it('reads every card and skips a file that declares no known kind', async () => {
    const fixture = await library()
    const cards = await listCards(fixture.root)
    expect(cards.map(card => card.id).sort()).toEqual(['concept-1', 'rule-1'])
    const rule = cards.find(card => card.id === 'rule-1')
    expect(rule?.domainL2).toBe('OA 答复')
    expect(rule?.status).toBe('confirmed')
    expect(rule?.relatedCount).toBe(2)
    expect(rule?.confidence).toBe(0.9)
  })

  it('falls back to the first heading when the frontmatter carries no title', async () => {
    const fixture = await library()
    await writeFile(join(fixture.root, 'cards', 'rule', 'untitled.md'), '---\nid: "x"\ntype: "rule"\n---\n\n# 标题来自正文\n')
    const cards = await listCards(fixture.root)
    expect(cards.find(card => card.id === 'x')?.title).toBe('标题来自正文')
  })

  it('reads an empty kind directory as no cards', async () => {
    const fixture = await library()
    await expect(listCards(join(fixture.root, 'nowhere'))).resolves.toEqual([])
  })

  it('uses documented fallbacks for absent fields', async () => {
    const fixture = await library()
    await writeFile(join(fixture.root, 'cards', 'concept', 'bare.md'), '---\nid: "bare"\ntype: "concept"\ntitle: ""\n---\n\n# 回退标题\n')
    const card = (await listCards(fixture.root)).find(item => item.id === 'bare')
    expect(card?.title).toBe('回退标题')
    expect(card?.domainL1).toBe('未分类')
    expect(card?.domainL2).toBe('未分类')
    expect(card?.concept).toBe('')
    expect(card?.status).toBe('draft')
    expect(card?.confidence).toBeUndefined()
    expect(card?.quality).toBeUndefined()
  })

  it('defaults the id to the path when the frontmatter carries none', async () => {
    const fixture = await library()
    await writeFile(join(fixture.root, 'cards', 'concept', 'noid.md'), '---\ntype: "concept"\ntitle: "无 id"\n---\n正文\n')
    const card = (await listCards(fixture.root)).find(item => item.path.endsWith('noid.md'))
    expect(card?.id).toBe('cards/concept/noid.md')
  })
})

describe('readCard', () => {
  it('reads one card with its body, provenance, and lists', async () => {
    const fixture = await library()
    const card = await readCard(fixture.root, 'cards/rule/rule-1.md')
    expect(card?.title).toBe('创造性判断的三步法')
    expect(card?.body).toContain('## 卡片内容')
    expect(card?.lawRefs).toEqual(['专利法第 22 条第 3 款'])
    expect(card?.relatedConcepts).toEqual(['old-1', 'old-2'])
    expect(card?.jurisdiction).toBe('CN')
    expect(card?.sourcePath).toBe('/vault/cards/rule-1.md')
    expect(card?.needsReview).toBe(true)
  })

  it('reads the pre-migration id a migrated card records', async () => {
    const fixture = await library()
    await writeFile(join(fixture.root, 'cards', 'rule', 'migrated.md'), [
      '---',
      'id: "rule-migrated"',
      'type: "rule"',
      'title: "迁移过的卡"',
      'migration:',
      '  from_id: "old-vault-id"',
      '  snapshot: "raw/snapshots/x"',
      '---',
      '正文。',
    ].join('\n'))
    const document = await readCard(fixture.root, 'cards/rule/migrated.md')
    expect(document?.fromId).toBe('old-vault-id')
    expect((await readCard(fixture.root, 'cards/rule/rule-1.md'))?.fromId).toBe('')
  })

  it('answers nothing for a path that escapes the root', async () => {
    const fixture = await library()
    await expect(readCard(fixture.root, '../outside.md')).resolves.toBeUndefined()
  })

  it('answers nothing for a missing file', async () => {
    const fixture = await library()
    await expect(readCard(fixture.root, 'cards/rule/gone.md')).resolves.toBeUndefined()
  })

  it('answers nothing for a directory', async () => {
    const fixture = await library()
    await expect(readCard(fixture.root, 'cards/rule')).resolves.toBeUndefined()
  })

  it('answers nothing for a file that declares no known kind', async () => {
    const fixture = await library()
    await expect(readCard(fixture.root, 'cards/notes.md')).resolves.toBeUndefined()
  })

  it('reads an absent jurisdiction and source as empty text', async () => {
    const fixture = await library()
    const card = await readCard(fixture.root, 'cards/concept/concept-1.md')
    expect(card?.jurisdiction).toBe('')
    expect(card?.sourcePath).toBe('')
    expect(card?.needsReview).toBe(false)
  })
})

describe('reports', () => {
  it('lists and reads the report files', async () => {
    const fixture = await library()
    await expect(listReports(fixture.root)).resolves.toEqual(['pilot-mapping.md'])
    const report = await readReport(fixture.root, 'pilot-mapping.md')
    expect(report?.text).toContain('试点映射报告')
  })

  it('reads a reports directory that is not there as no reports', async () => {
    const fixture = await library()
    await expect(listReports(join(fixture.root, 'missing'))).resolves.toEqual([])
  })

  it('answers nothing for a report name that escapes the directory', async () => {
    const fixture = await library()
    await expect(readReport(fixture.root, '../index/card-index.json')).resolves.toBeUndefined()
  })

  it('answers nothing for a missing report', async () => {
    const fixture = await library()
    await expect(readReport(fixture.root, 'gone.md')).resolves.toBeUndefined()
  })

  it('answers nothing for a directory named like a report', async () => {
    const fixture = await library()
    await mkdir(join(fixture.root, 'reports', 'nested.md'), { recursive: true })
    await expect(readReport(fixture.root, 'nested.md')).resolves.toBeUndefined()
  })
})

describe('counts and branches', () => {
  it('counts by kind, domain, and status', async () => {
    const fixture = await library()
    const counts = countsOf(await listCards(fixture.root))
    expect(counts).toEqual({
      total: 2,
      byType: { concept: 1, rule: 1 },
      byDomain: { 'OA 答复': 1, '权利要求与说明书': 1 },
      byStatus: { confirmed: 1, draft: 1 },
    })
  })

  it('orders branches by kind and groups by domain', async () => {
    const fixture = await library()
    const branches = branchCards(await listCards(fixture.root))
    expect(branches.map(branch => branch.type)).toEqual(['concept', 'rule'])
    expect(branches[1]?.label).toBe('规则卡')
    expect(branches[1]?.total).toBe(1)
    expect(branches[1]?.groups[0]?.key).toBe('rule/OA 答复')
    expect(branches[1]?.groups[0]?.cards[0]?.title).toBe('创造性判断的三步法')
  })

  it('groups every card of one domain together', async () => {
    const fixture = await library()
    await writeFile(join(fixture.root, 'cards', 'rule', 'rule-2.md'), '---\nid: "rule-2"\ntype: "rule"\ntitle: "第二张规则卡"\ndomain_l2: "OA 答复"\n---\n正文\n')
    const branches = branchCards(await listCards(fixture.root))
    const rule = branches.find(branch => branch.type === 'rule')
    expect(rule?.groups).toHaveLength(1)
    expect(rule?.groups[0]?.cards.map(card => card.title).sort()).toEqual(['创造性判断的三步法', '第二张规则卡'])
  })

  it('groups an empty domain under 未分类 and skips a kind with no card', async () => {
    const fixture = await library()
    await writeFile(join(fixture.root, 'cards', 'concept', 'nada.md'), '---\nid: "nada"\ntype: "concept"\ntitle: "无域"\ndomain_l2: ""\n---\n正文\n')
    const branches = branchCards(await listCards(fixture.root))
    expect(branches.map(branch => branch.type)).toEqual(['concept', 'rule'])
    expect(branches[0]?.groups.map(group => group.label)).toContain('未分类')
  })
})

describe('readStatus', () => {
  it('reports a matching index, the report count, and the review queue', async () => {
    const fixture = await library()
    const status = await readStatus(fixture.root)
    expect(status.exists).toBe(true)
    expect(status.counts.total).toBe(2)
    expect(status.indexDrift).toBe('none')
    expect(status.indexTotalCards).toBe(2)
    expect(status.indexGeneratedAt).toBe('2026-09-29T18:52:51.675720+08:00')
    expect(status.reports).toEqual(['pilot-mapping.md'])
    expect(status.needsReview.map(card => card.id)).toEqual(['concept-1'])
    expect(status.problem).toBe('')
  })

  it('reports a count mismatch against the derived index', async () => {
    const fixture = await library({ indexTotal: 30 })
    await expect(readStatus(fixture.root)).resolves.toMatchObject({ indexDrift: 'count-mismatch' })
  })

  it('reports a missing index', async () => {
    const fixture = await library({ omitIndex: true })
    await expect(readStatus(fixture.root)).resolves.toMatchObject({ indexDrift: 'unreadable' })
  })

  it('reports an index without a count', async () => {
    const fixture = await library({ indexText: '{"schema_version":1}' })
    await expect(readStatus(fixture.root)).resolves.toMatchObject({ indexDrift: 'missing' })
  })

  it('reports an index whose JSON is not an object', async () => {
    const fixture = await library({ indexText: '42' })
    await expect(readStatus(fixture.root)).resolves.toMatchObject({ indexDrift: 'unreadable' })
  })

  it('orders the review queue by confidence, then by title', async () => {
    const fixture = await library()
    await writeFile(join(fixture.root, 'cards', 'concept', 'low.md'), '---\nid: "low"\ntype: "concept"\ntitle: "最不确定"\nconfidence: 0.3\n---\n正文\n')
    await writeFile(join(fixture.root, 'cards', 'concept', 'tie-a.md'), '---\nid: "tie-a"\ntype: "concept"\ntitle: "AAA"\nconfidence: 0.5\n---\n正文\n')
    await writeFile(join(fixture.root, 'cards', 'concept', 'tie-b.md'), '---\nid: "tie-b"\ntype: "concept"\ntitle: "BBB"\nconfidence: 0.5\n---\n正文\n')
    const status = await readStatus(fixture.root)
    expect(status.needsReview.map(card => card.id)).toEqual(['low', 'tie-a', 'tie-b', 'concept-1'])
  })

  it('reports a missing root with the problem that explains it', async () => {
    const fixture = await library()
    const status = await readStatus(join(fixture.root, 'gone'))
    expect(status.exists).toBe(false)
    expect(status.problem).toContain('库根不存在')
    expect(status.counts.total).toBe(0)
  })

  it('reports a root that is a file, not a directory', async () => {
    const fixture = await library()
    const status = await readStatus(fixture.rulePath)
    expect(status.exists).toBe(false)
    expect(status.problem).toContain('库根不是目录')
  })
})

describe('readTree', () => {
  it('returns the status and the branches together', async () => {
    const fixture = await library()
    const tree = await readTree(fixture.root)
    expect(tree.status.counts.total).toBe(2)
    expect(tree.branches).toHaveLength(2)
  })

  it('returns no branches for a root that is not there', async () => {
    const fixture = await library()
    const tree = await readTree(join(fixture.root, 'gone'))
    expect(tree.branches).toEqual([])
    expect(tree.status.exists).toBe(false)
  })
})
