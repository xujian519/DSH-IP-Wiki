/** The agent-facing tools: argument reading, citation checking, and the three operations. */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CardDocument, SearchResult } from '../src/shared/card'
import { listDrafts, writeDraft } from '../src/host/drafts'
import { enumArg, ipWikiTools, limitArg, listArg, stringArg, verifyCitation, type ToolDefinitionLike } from '../src/host/tools'
import type { SearchService } from '../src/host/search'
import { makeLibrary, type FixtureLibrary } from './fixtures'

/** Libraries created by the running test, removed afterwards. */
const created: FixtureLibrary[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map(async fixture => { await fixture.dispose() }))
})

/**
 * Write a throwaway library.
 * @returns the fixture.
 */
async function library(): Promise<FixtureLibrary> {
  const fixture = await makeLibrary()
  created.push(fixture)
  return fixture
}

/** A retrieval double that answers one fixed result. */
function searchStub(result: Partial<SearchResult> = {}): SearchService {
  const answer: SearchResult = {
    query: '三步法',
    mode: 'rerank',
    degraded: '',
    scanned: 2,
    deprecated: 0,
    duplicates: 0,
    hits: [{
      path: 'cards/rule/rule-1.md',
      title: '创造性判断的三步法',
      type: 'rule',
      domainL2: 'OA 答复',
      concept: '三步法',
      lawRefs: ['专利法第 22 条第 3 款'],
      sourcePath: '/vault/cards/rule-1.md',
      status: 'draft',
      score: 0.9,
      matched: ['keyword', 'vector', 'rerank'],
      snippet: '三步法的第一步',
    }],
    ...result,
  }
  return {
    search: async () => answer,
    describe: async () => ({ semantic: true, reason: '', embedModel: 'model', warmed: 0, total: 0 }),
    warm: () => () => {},
  }
}

/** The tool with one name, or a failure naming what was missing. */
function toolNamed(tools: readonly ToolDefinitionLike[], name: string): ToolDefinitionLike {
  const found = tools.find(tool => tool.name === name)
  if (found === undefined) throw new Error(`no tool named ${name}`)
  return found
}

/** Render one tool's result, as the transcript would. */
function rendered(tool: ToolDefinitionLike, value: unknown): string {
  return tool.output.render({}, value).map(block => block.text).join('\n')
}

describe('stringArg', () => {
  it('reads a trimmed string', () => {
    expect(stringArg({ query: '  三步法 ' }, 'query')).toBe('三步法')
  })

  it('rejects a missing, non-string, or blank field', () => {
    expect(stringArg({}, 'query')).toBeUndefined()
    expect(stringArg({ query: 3 }, 'query')).toBeUndefined()
    expect(stringArg({ query: '   ' }, 'query')).toBeUndefined()
  })

  it('rejects arguments that are not an object', () => {
    expect(stringArg('nope', 'query')).toBeUndefined()
    expect(stringArg(null, 'query')).toBeUndefined()
    expect(stringArg([1], 'query')).toBeUndefined()
  })
})

describe('limitArg', () => {
  it('reads a usable integer', () => {
    expect(limitArg({ limit: 3 }, 'limit')).toBe(3)
  })

  it('floors a fractional limit', () => {
    expect(limitArg({ limit: 2.7 }, 'limit')).toBe(2)
  })

  it('falls back for a missing, non-numeric, or below-one limit', () => {
    expect(limitArg({}, 'limit')).toBe(8)
    expect(limitArg({ limit: '3' }, 'limit')).toBe(8)
    expect(limitArg({ limit: 0 }, 'limit')).toBe(8)
    expect(limitArg({ limit: Number.POSITIVE_INFINITY }, 'limit')).toBe(8)
  })

  it('caps a limit above the ceiling', () => {
    expect(limitArg({ limit: 500 }, 'limit')).toBe(50)
  })

  it('falls back when the arguments are not an object', () => {
    expect(limitArg(undefined, 'limit')).toBe(8)
  })
})

describe('enumArg', () => {
  it('reads a value from the closed set', () => {
    expect(enumArg({ action: 'list' }, 'action', ['list', 'view'])).toBe('list')
  })

  it('rejects a value outside the set, a missing field, and arguments that are not an object', () => {
    expect(enumArg({ action: 'other' }, 'action', ['list', 'view'])).toBeUndefined()
    expect(enumArg({}, 'action', ['list', 'view'])).toBeUndefined()
    expect(enumArg('nope', 'action', ['list', 'view'])).toBeUndefined()
  })
})

describe('listArg', () => {
  it('reads a list of non-empty strings', () => {
    expect(listArg({ supersedes: [' a.md ', '', 3, 'b.md'] }, 'supersedes')).toEqual(['a.md', 'b.md'])
  })

  it('rejects a missing field, a non-list, and arguments that are not an object', () => {
    expect(listArg({}, 'supersedes')).toBeUndefined()
    expect(listArg({ supersedes: 'a.md' }, 'supersedes')).toBeUndefined()
    expect(listArg(null, 'supersedes')).toBeUndefined()
  })
})

describe('verifyCitation', () => {
  const document: CardDocument = {
    id: 'a',
    type: 'rule',
    title: '标题',
    domainL1: '专利',
    domainL2: 'OA 答复',
    concept: '',
    status: 'draft',
    confidence: undefined,
    quality: undefined,
    path: 'cards/rule/a.md',
    relatedCount: 0,
    body: '# 标题\n\n三步法的第一步是确定最接近的现有技术。',
    lawRefs: [],
    relatedConcepts: [],
    wikiLinks: [],
    jurisdiction: '',
    fromId: '',
    supersededBy: '',
    sourcePath: '',
    needsReview: false,
  }

  it('finds a quotation that ignores line wrapping', () => {
    const verdict = verifyCitation(document, '三步法的第一步\n是确定最接近的现有技术')
    expect(verdict.found).toBe(true)
    expect(verdict.context).toContain('三步法')
  })

  it('reports a quotation the card does not carry', () => {
    const verdict = verifyCitation(document, '现有技术抗辩')
    expect(verdict).toEqual({ found: false, path: 'cards/rule/a.md', quote: '现有技术抗辩', context: '' })
  })
})

describe('ipWikiTools', () => {
  it('declares the reading tools and the draft tools in registration order', async () => {
    const fixture = await library()
    const tools = ipWikiTools({ libraryRoot: fixture.root, search: searchStub() })
    expect(tools.map(tool => tool.name)).toEqual([
      'ip_wiki_search', 'ip_wiki_get', 'ip_wiki_cite', 'ip_wiki_draft', 'ip_wiki_review', 'ip_wiki_confirm', 'ip_wiki_lint',
    ])
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(10)
      expect(tool.parameters).toMatchObject({ type: 'object', additionalProperties: false })
    }
  })

  it('searches and renders the hits with their provenance', async () => {
    const fixture = await library()
    const tool = toolNamed(ipWikiTools({ libraryRoot: fixture.root, search: searchStub() }), 'ip_wiki_search')
    const value = await tool.execute({ query: '三步法', limit: 2 })
    const text = rendered(tool, value)
    expect(text).toContain('命中 1 张')
    expect(text).toContain('创造性判断的三步法')
    expect(text).toContain('规则卡')
    expect(text).toContain('专利法第 22 条第 3 款')
    expect(text).toContain('cards/rule/rule-1.md')
    expect(text).toContain('/vault/cards/rule-1.md')
    expect(text).toContain('三步法的第一步')
    expect(text).not.toContain('已废弃')
  })

  it('says how many deprecated cards sank below the live hits', async () => {
    const fixture = await library()
    const tool = toolNamed(ipWikiTools({
      libraryRoot: fixture.root,
      search: searchStub({ scanned: 139, deprecated: 22 }),
    }), 'ip_wiki_search')
    const text = rendered(tool, await tool.execute({ query: '三步法' }))
    expect(text).toContain('扫描 139 张；已废弃 22 张排在末尾')
  })

  it('says how many repeated cards sank below the distinct hits', async () => {
    const fixture = await library()
    const tool = toolNamed(ipWikiTools({
      libraryRoot: fixture.root,
      search: searchStub({ scanned: 139, duplicates: 4 }),
    }), 'ip_wiki_search')
    const text = rendered(tool, await tool.execute({ query: '三步法' }))
    expect(text).toContain('扫描 139 张；与前一张重复 4 张排在末尾')
  })

  it('renders an empty result with the stage that ran', async () => {
    const fixture = await library()
    const tool = toolNamed(ipWikiTools({
      libraryRoot: fixture.root,
      search: searchStub({ mode: 'keyword', degraded: '未配置 embedding', hits: [] }),
    }), 'ip_wiki_search')
    const text = rendered(tool, await tool.execute({ query: '三步法' }))
    expect(text).toContain('没有命中')
    expect(text).toContain('未配置 embedding')
  })

  it('renders a hit without a concept or a source', async () => {
    const fixture = await library()
    const tool = toolNamed(ipWikiTools({
      libraryRoot: fixture.root,
      search: searchStub({
        hits: [{
          path: 'cards/rule/x.md',
          title: '无来源的卡',
          type: 'rule',
          domainL2: '未分类',
          concept: '',
          lawRefs: [],
          sourcePath: '',
          status: 'confirmed',
          score: 0.1,
          matched: ['keyword'],
          snippet: '片段',
        }],
      }),
    }), 'ip_wiki_search')
    const text = rendered(tool, await tool.execute({ query: '三步法' }))
    expect(text).toContain('无来源的卡')
    expect(text).not.toContain('法条依据')
    expect(text).not.toContain('来源：')
  })

  it('refuses a search without a query', async () => {
    const fixture = await library()
    const tool = toolNamed(ipWikiTools({ libraryRoot: fixture.root, search: searchStub() }), 'ip_wiki_search')
    await expect(tool.execute({})).rejects.toThrow('query 必填')
  })

  it('reads a card and renders it with its facts', async () => {
    const fixture = await library()
    const tool = toolNamed(ipWikiTools({ libraryRoot: fixture.root, search: searchStub() }), 'ip_wiki_get')
    const text = rendered(tool, await tool.execute({ path: 'cards/rule/rule-1.md' }))
    expect(text).toContain('# 创造性判断的三步法')
    expect(text).toContain('专利法第 22 条第 3 款')
    expect(text).toContain('/vault/cards/rule-1.md')
    expect(text).toContain('## 卡片内容')
  })

  it('renders a card that cites no law and records no source', async () => {
    const fixture = await library()
    const tool = toolNamed(ipWikiTools({ libraryRoot: fixture.root, search: searchStub() }), 'ip_wiki_get')
    const text = rendered(tool, await tool.execute({ path: 'cards/concept/concept-1.md' }))
    expect(text).toContain('# 什么是功能性特征')
    expect(text).not.toContain('法条依据')
    expect(text).not.toContain('来源：')
  })

  it('names the lifecycle status of the cards it renders', async () => {
    const fixture = await library()
    const tools = ipWikiTools({ libraryRoot: fixture.root, search: searchStub() })
    await writeFile(join(fixture.root, 'cards', 'rule', 'old.md'),
      '---\ntype: "rule"\ntitle: "旧卡"\nstatus: "deprecated"\n---\n\n正文。\n')
    const get = toolNamed(tools, 'ip_wiki_get')
    expect(rendered(get, await get.execute({ path: 'cards/rule/rule-1.md' }))).toContain('状态：已确认')
    expect(rendered(get, await get.execute({ path: 'cards/rule/old.md' }))).toContain('状态：已废弃')
    expect(rendered(get, await get.execute({ path: 'cards/concept/concept-1.md' }))).toContain('状态：未确认')
  })

  it('refuses a card read without a path, and one the library does not hold', async () => {
    const fixture = await library()
    const tool = toolNamed(ipWikiTools({ libraryRoot: fixture.root, search: searchStub() }), 'ip_wiki_get')
    await expect(tool.execute({})).rejects.toThrow('path 必填')
    await expect(tool.execute({ path: 'cards/rule/gone.md' })).rejects.toThrow('库里没有这张卡片')
  })

  it('checks a quotation and renders both verdicts', async () => {
    const fixture = await library()
    const tool = toolNamed(ipWikiTools({ libraryRoot: fixture.root, search: searchStub() }), 'ip_wiki_cite')
    const good = rendered(tool, await tool.execute({ path: 'cards/rule/rule-1.md', quote: '确定最接近的现有技术' }))
    expect(good).toContain('✅ 逐字命中')
    const bad = rendered(tool, await tool.execute({ path: 'cards/rule/rule-1.md', quote: '这句话卡里没有' }))
    expect(bad).toContain('❌ 卡片里没有这段原文')
  })

  it('refuses a citation check without its arguments, and for an unknown card', async () => {
    const fixture = await library()
    const tool = toolNamed(ipWikiTools({ libraryRoot: fixture.root, search: searchStub() }), 'ip_wiki_cite')
    await expect(tool.execute({ quote: 'x' })).rejects.toThrow('path 必填')
    await expect(tool.execute({ path: 'cards/rule/rule-1.md' })).rejects.toThrow('quote 必填')
    await expect(tool.execute({ path: 'cards/rule/gone.md', quote: 'x' })).rejects.toThrow('库里没有这张卡片')
  })
})

describe('the quality gate tool', () => {
  it('runs the gate and renders its findings by tier', async () => {
    const fixture = await library()
    const tool = toolNamed(ipWikiTools({
      libraryRoot: fixture.root,
      search: searchStub(),
      lintFailOn: 'warning',
    }), 'ip_wiki_lint')
    const text = rendered(tool, await tool.execute({}))
    expect(text).toContain('质量门禁')
    expect(text).toContain('失败线 warning')
    expect(text).toContain('扫描 2 张')
    expect(text).toContain('⚠️')
    expect(text).toContain('[broken-link]')
    expect(text).toContain('cards/rule/rule-1.md')
  })

  it('marks every tier and truncates a long finding list', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ip-wiki-lint-'))
    try {
      await mkdir(join(root, 'cards', 'rule'), { recursive: true })
      await mkdir(join(root, 'index'), { recursive: true })
      for (let index = 0; index < 45; index += 1) {
        await writeFile(join(root, 'cards', 'rule', `c${String(index)}.md`), [
          '---',
          `id: "c${String(index)}"`,
          'type: "rule"',
          `title: "卡 ${String(index)}"`,
          '---',
          '正文。',
        ].join('\n'))
      }
      await writeFile(join(root, 'cards', 'rule', 'untitled.md'), '---\nid: "u"\ntype: "rule"\ntitle: ""\n---\n正文。\n')
      // A stale index adds the one library-wide finding, which renders as (库级).
      await writeFile(join(root, 'index', 'card-index.json'), JSON.stringify({ total_cards: 99 }))
      const tool = toolNamed(ipWikiTools({ libraryRoot: root, search: searchStub(), lintFailOn: 'critical' }), 'ip_wiki_lint')
      const text = rendered(tool, await tool.execute({}))
      expect(text).toContain('⛔')
      expect(text).toContain('·')
      expect(text).toContain('还有')
      expect(text).toContain('(库级)')
      expect(text).toContain('❌ 未通过')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('passes a clean library and falls back to the default failure line', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ip-wiki-clean-'))
    try {
      await mkdir(join(root, 'cards', 'rule'), { recursive: true })
      await mkdir(join(root, 'index'), { recursive: true })
      await writeFile(join(root, 'cards', 'rule', 'a.md'), [
        '---',
        'id: "a"',
        'type: "rule"',
        'title: "甲"',
        'domain_l2: "OA 答复"',
        'concept: "甲概念"',
        'confidence: 0.9',
        'related_concepts:',
        '  - "b"',
        '---',
        '正文。',
      ].join('\n'))
      await writeFile(join(root, 'cards', 'rule', 'b.md'), [
        '---',
        'id: "b"',
        'type: "rule"',
        'title: "乙"',
        'domain_l2: "OA 答复"',
        'concept: "乙概念"',
        'confidence: 0.9',
        '---',
        '正文。',
      ].join('\n'))
      await writeFile(join(root, 'index', 'card-index.json'), JSON.stringify({ total_cards: 2 }))
      const tool = toolNamed(ipWikiTools({ libraryRoot: root, search: searchStub() }), 'ip_wiki_lint')
      const text = rendered(tool, await tool.execute({}))
      expect(text).toContain('失败线 warning')
      expect(text).toContain('没有发现任何问题')
      expect(text).toContain('✅ 通过')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('takes the failure line from the call', async () => {
    const fixture = await library()
    const tool = toolNamed(ipWikiTools({ libraryRoot: fixture.root, search: searchStub() }), 'ip_wiki_lint')
    const text = rendered(tool, await tool.execute({ failOn: 'critical' }))
    expect(text).toContain('失败线 critical')
    expect(text).toContain('✅ 通过')
  })
})

describe('the model-facing tool contract', () => {
  /** One valid call per tool, so every declared output can be exercised. */
  const CALLS: Readonly<Record<string, unknown>> = {
    ip_wiki_search: { query: '三步法' },
    ip_wiki_get: { path: 'cards/rule/rule-1.md' },
    ip_wiki_cite: { path: 'cards/rule/rule-1.md', quote: '确定最接近的现有技术' },
    ip_wiki_draft: {
      path: 'cards/rule/contract.md',
      content: '---\nid: "c"\ntype: "rule"\ntitle: "契约卡"\n---\n\n正文。\n',
      classification: 'public',
      generatedBy: 'human',
    },
    ip_wiki_review: { action: 'list' },
    ip_wiki_confirm: { scope: 'all-draft' },
    ip_wiki_lint: {},
  }

  it('returns exactly the text value each tool declares', async () => {
    const fixture = await library()
    const tools = ipWikiTools({ libraryRoot: fixture.root, search: searchStub() })
    // The registry validates the resolved value against this schema before it
    // renders, so a mismatch fails every live call with INVALID_TOOL_OUTPUT — the
    // bug this test exists to catch, which the direct execute+render evals missed.
    for (const tool of tools) {
      expect(tool.output.schema).toEqual({
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      })
      const value = await tool.execute(CALLS[tool.name])
      expect(Object.keys(value as Record<string, unknown>)).toEqual(['text'])
      const text = (value as { text: unknown }).text
      expect(typeof text).toBe('string')
      expect(text).not.toBe('')
      expect(rendered(tool, value)).toBe(text)
    }
  })
})

describe('the draft tools', () => {
  /** A card text a draft can propose. */
  const CARD = '---\nid: "x"\ntype: "rule"\ntitle: "拟新增"\n---\n\n# 拟新增\n\n正文。\n'

  it('drafts a card, renders the difference, and does not land it', async () => {
    const fixture = await library()
    const tool = toolNamed(ipWikiTools({ libraryRoot: fixture.root, search: searchStub() }), 'ip_wiki_draft')
    const value = await tool.execute({
      path: 'cards/rule/proposed.md',
      content: CARD,
      classification: 'public',
      generatedBy: 'local-model',
      note: '来自 PDF',
    })
    const text = rendered(tool, value)
    expect(text).toContain('待确认')
    expect(text).toContain('目标：cards/rule/proposed.md（新建卡片）')
    expect(text).toContain('+')
    expect(text).toContain('来自 PDF')
    expect(text).toContain('ip_wiki_review(action="confirm"')
    await expect(stat(join(fixture.root, 'cards/rule/proposed.md'))).rejects.toThrow()
  })

  it('carries the material reference a reviewer needs', async () => {
    const fixture = await library()
    const tool = toolNamed(ipWikiTools({ libraryRoot: fixture.root, search: searchStub() }), 'ip_wiki_draft')
    const text = rendered(tool, await tool.execute({
      path: 'cards/rule/from-web.md',
      content: CARD,
      classification: 'public',
      generatedBy: 'human',
      sourceRef: 'https://example.com/oa-guide',
    }))
    expect(text).toContain('https://example.com/oa-guide')
  })

  it('shows a replacement, its removed lines, and the truncation notice', async () => {
    const fixture = await library()
    const tool = toolNamed(ipWikiTools({ libraryRoot: fixture.root, search: searchStub() }), 'ip_wiki_draft')
    const long = `---\nid: "x"\ntype: "rule"\ntitle: "长草稿"\n---\n\n# 长草稿\n\n${Array.from({ length: 150 }, (_, index) => `第 ${String(index + 1)} 行`).join('\n')}\n`
    const text = rendered(tool, await tool.execute({
      path: 'cards/rule/rule-1.md',
      content: long,
      classification: 'public',
      generatedBy: 'human',
    }))
    expect(text).toContain('将替换现有卡片')
    expect(text).toContain('请在面板里查看完整差异')
    expect(text).toContain('-')
    expect(text).toContain(' ')
  })

  it('drafts a merge and names the cards it will absorb', async () => {
    const fixture = await library()
    const tool = toolNamed(ipWikiTools({ libraryRoot: fixture.root, search: searchStub() }), 'ip_wiki_draft')
    const text = rendered(tool, await tool.execute({
      path: 'cards/rule/merged.md',
      content: CARD,
      classification: 'public',
      generatedBy: 'human',
      supersedes: ['cards/rule/rule-1.md', 'cards/concept/concept-1.md'],
    }))
    expect(text).toContain('合并')
    expect(text).toContain('确认后将弃用 2 张卡')
    expect(text).toContain('cards/rule/rule-1.md')
    expect(text).toContain('cards/concept/concept-1.md')
    expect(text).toContain('superseded_by')
  })

  it('refuses a merge that names a card it cannot absorb', async () => {
    const fixture = await library()
    const tool = toolNamed(ipWikiTools({ libraryRoot: fixture.root, search: searchStub() }), 'ip_wiki_draft')
    await expect(tool.execute({
      path: 'cards/rule/merged.md',
      content: CARD,
      classification: 'public',
      generatedBy: 'human',
      supersedes: ['cards/rule/gone.md'],
    })).rejects.toThrow(/there is no card at that path/u)
  })

  it('refuses a draft without its required arguments', async () => {
    const fixture = await library()
    const tool = toolNamed(ipWikiTools({ libraryRoot: fixture.root, search: searchStub() }), 'ip_wiki_draft')
    await expect(tool.execute({ content: CARD, classification: 'public', generatedBy: 'human' })).rejects.toThrow('path 必填')
    await expect(tool.execute({ path: 'cards/rule/a.md', classification: 'public', generatedBy: 'human' })).rejects.toThrow('content 必填')
    await expect(tool.execute({ path: 'cards/rule/a.md', content: CARD, generatedBy: 'human' })).rejects.toThrow('classification 必须是')
    await expect(tool.execute({ path: 'cards/rule/a.md', content: CARD, classification: 'public' })).rejects.toThrow('generatedBy 必须是')
  })

  it('refuses the origin a client-material policy forbids', async () => {
    const fixture = await library()
    const tool = toolNamed(ipWikiTools({ libraryRoot: fixture.root, search: searchStub() }), 'ip_wiki_draft')
    await expect(tool.execute({
      path: 'cards/rule/a.md',
      content: CARD,
      classification: 'client-material',
      generatedBy: 'dsh-model',
    })).rejects.toThrow(/cannot record generatedBy: dsh-model/u)
  })

  it('lists, views, confirms, discards, and reverts through one tool', async () => {
    const fixture = await library()
    const tools = ipWikiTools({ libraryRoot: fixture.root, search: searchStub() })
    const review = toolNamed(tools, 'ip_wiki_review')
    expect(rendered(review, await review.execute({ action: 'list' }))).toContain('没有待确认的草稿')

    const draft = await writeDraft(fixture.root, {
      path: 'cards/rule/proposed.md',
      content: CARD,
      classification: 'public',
      generatedBy: 'human',
    }, undefined)
    expect(rendered(review, await review.execute({ action: 'list' }))).toContain(draft.id)
    expect(rendered(review, await review.execute({ action: 'view', id: draft.id }))).toContain('差异')
    expect(rendered(review, await review.execute({ action: 'confirm', id: draft.id }))).toContain('已落库')
    expect(await readFile(join(fixture.root, 'cards/rule/proposed.md'), 'utf8')).toBe(CARD)
    expect(rendered(review, await review.execute({ action: 'revert', id: draft.id }))).toContain('已回滚')
    await expect(stat(join(fixture.root, 'cards/rule/proposed.md'))).rejects.toThrow()

    const second = await writeDraft(fixture.root, {
      path: 'cards/rule/proposed.md',
      content: CARD,
      classification: 'public',
      generatedBy: 'human',
    }, undefined)
    expect(rendered(review, await review.execute({ action: 'discard', id: second.id }))).toContain('已作废')
  })

  it('reports a replacement and its rollback back to the original', async () => {
    const fixture = await library()
    const review = toolNamed(ipWikiTools({ libraryRoot: fixture.root, search: searchStub() }), 'ip_wiki_review')
    const draft = await writeDraft(fixture.root, {
      path: 'cards/rule/rule-1.md',
      content: CARD,
      classification: 'public',
      generatedBy: 'human',
    }, undefined)
    expect(rendered(review, await review.execute({ action: 'confirm', id: draft.id }))).toContain('替换了原卡片')
    expect(rendered(review, await review.execute({ action: 'revert', id: draft.id }))).toContain('恢复为确认前的原文')
  })

  it('refuses a review call without a usable action or id', async () => {
    const fixture = await library()
    const review = toolNamed(ipWikiTools({ libraryRoot: fixture.root, search: searchStub() }), 'ip_wiki_review')
    await expect(review.execute({})).rejects.toThrow('action 必须是')
    await expect(review.execute({ action: 'confirm' })).rejects.toThrow('action=confirm 需要 id')
    await expect(review.execute({ action: 'view', id: 'nope' })).rejects.toThrow('没有这份草稿')
  })
})

describe('the confirmation tool', () => {
  /** The tool under test, with a throwaway library. */
  async function confirmTool(fixture: FixtureLibrary): Promise<ToolDefinitionLike> {
    return toolNamed(ipWikiTools({ libraryRoot: fixture.root, search: searchStub() }), 'ip_wiki_confirm')
  }

  it('queues the cards it is given and names the ones it skipped', async () => {
    const fixture = await library()
    const tool = await confirmTool(fixture)
    const text = rendered(tool, await tool.execute({
      paths: ['cards/concept/concept-1.md', 'cards/rule/rule-1.md'],
    }))
    expect(text).toContain('已提交 1 份状态确认草稿（跳过 1 张）')
    expect(text).toContain('cards/concept/concept-1.md')
    expect(text).toContain('cards/rule/rule-1.md｜已是已确认')
    expect(text).toContain('ip_wiki_review(action="confirm"')
    expect(text).toContain('回滚')
    // Queueing a confirmation is not landing it.
    expect(await readFile(join(fixture.root, 'cards/concept/concept-1.md'), 'utf8')).toContain('confidence: 0.62')
    expect(await readFile(join(fixture.root, 'cards/concept/concept-1.md'), 'utf8')).not.toContain('status:')
  })

  it('queues every unconfirmed card when the caller names the scope', async () => {
    const fixture = await library()
    const tool = await confirmTool(fixture)
    const text = rendered(tool, await tool.execute({ scope: 'all-draft' }))
    expect(text).toContain('已提交 1 份状态确认草稿（跳过 0 张）')
    expect(text).toContain('cards/concept/concept-1.md')
    // The confirmed card and the file that declares no card type are left alone.
    expect(text).not.toContain('cards/rule/rule-1.md')
    expect(text).not.toContain('cards/notes.md')
  })

  it('names a deprecated card among the skips', async () => {
    const fixture = await library()
    await writeFile(join(fixture.root, 'cards', 'rule', 'old.md'),
      '---\ntype: "rule"\ntitle: "旧卡"\nstatus: "deprecated"\n---\n\n正文。\n')
    const tool = await confirmTool(fixture)
    const text = rendered(tool, await tool.execute({ paths: ['cards/rule/old.md'] }))
    expect(text).toContain('已提交 0 份状态确认草稿（跳过 1 张）')
    expect(text).toContain('cards/rule/old.md｜已废弃')
    expect(text).not.toContain('待确认草稿（在面板')
  })

  it('truncates a long queue and a long skip list', async () => {
    const fixture = await library()
    const rule = await readFile(fixture.rulePath, 'utf8')
    const paths: string[] = []
    for (let index = 0; index < 45; index += 1) {
      await writeFile(join(fixture.root, 'cards', 'rule', `d${String(index)}.md`),
        `---\ntype: "rule"\ntitle: "草稿 ${String(index)}"\nstatus: "draft"\n---\n\n正文。\n`)
      await writeFile(join(fixture.root, 'cards', 'rule', `done${String(index)}.md`),
        rule.replace('rule-1', `done-${String(index)}`))
      paths.push(`cards/rule/done${String(index)}.md`)
    }
    const tool = await confirmTool(fixture)
    const queued = rendered(tool, await tool.execute({ scope: 'all-draft' }))
    expect(queued).toContain('已提交 46 份状态确认草稿')
    expect(queued).toContain('…（还有 6 份）')
    const skipped = rendered(tool, await tool.execute({ paths }))
    expect(skipped).toContain('（跳过 45 张）')
    expect(skipped).toContain('…（还有 5 张）')
  })

  it('marks the queue by kind when the review tool lists and views it', async () => {
    const fixture = await library()
    const confirm = await confirmTool(fixture)
    await confirm.execute({ paths: ['cards/concept/concept-1.md'] })
    const statusDraft = (await listDrafts(fixture.root)).find(draft => draft.kind === 'status')
    if (statusDraft === undefined) throw new Error('expected a status draft')
    await writeDraft(fixture.root, {
      path: 'cards/rule/merged.md',
      content: '---\ntype: "rule"\ntitle: "合并卡"\n---\n\n正文。\n',
      classification: 'public',
      generatedBy: 'human',
      supersedes: ['cards/rule/rule-1.md'],
    }, undefined)
    const review = toolNamed(ipWikiTools({ libraryRoot: fixture.root, search: searchStub() }), 'ip_wiki_review')
    const listed = rendered(review, await review.execute({ action: 'list' }))
    expect(listed).toContain('｜状态确认｜')
    expect(listed).toContain('｜合并｜')
    const viewed = rendered(review, await review.execute({ action: 'view', id: statusDraft.id }))
    expect(viewed).toContain('待确认，状态确认')
    expect(viewed).toContain('+status: "confirmed"')
  })

  it('refuses a call that names neither a path nor a scope', async () => {
    const fixture = await library()
    const tool = await confirmTool(fixture)
    await expect(tool.execute({})).rejects.toThrow('要么给 paths，要么给 scope="all-draft"')
    await expect(tool.execute({ paths: [] })).rejects.toThrow('要么给 paths，要么给 scope="all-draft"')
    await expect(tool.execute({ paths: ['index/card-index.json'] })).rejects.toThrow(/must be a \.md file under cards\//u)
  })
})
