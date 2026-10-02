/** The retrieval pipeline: staged recall, ordering, and every degradation path. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_EMBED_MODEL, type EmbeddingPlan } from '../src/host/embeddings'
import { createSearchService, suppressNearDuplicates, zipVectors } from '../src/host/search'
import type { Fetcher } from '../src/shared/wire'

/** A resolved plan the pipeline tests build on, with reranking off unless a spec asks for it. */
const PLAN: Extract<EmbeddingPlan, { enabled: true }> = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:8000',
  embedModel: DEFAULT_EMBED_MODEL,
  rerankModel: 'reranker',
  apiKeyFile: '',
  timeoutMs: 1000,
  rerank: false,
}

/** The same plan with the reranker in the pipeline. */
const PLAN_RERANK: Extract<EmbeddingPlan, { enabled: true }> = { ...PLAN, rerank: true }

/** The plan that switches semantic retrieval off. */
const OFF: EmbeddingPlan = { enabled: false, reason: '未配置 embedding' }

/** Libraries created by the running test, removed afterwards. */
const created: string[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map(async root => { await rm(root, { recursive: true, force: true }) }))
})

/**
 * Write a two-card library and a key file the plan can read.
 * @returns the library root and the key file path.
 */
async function library(): Promise<{ readonly root: string; readonly keyFile: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ip-wiki-search-'))
  created.push(root)
  await mkdir(join(root, 'cards', 'rule'), { recursive: true })
  await writeFile(join(root, 'cards', 'rule', 'alpha.md'), [
    '---',
    'id: "alpha"',
    'type: "rule"',
    'title: "创造性判断的三步法"',
    'domain_l2: "OA 答复"',
    'concept: "三步法"',
    'law_refs:',
    '  - "专利法第 22 条第 3 款"',
    'source:',
    '  path: "/vault/alpha.md"',
    '---',
    '# 创造性判断的三步法',
    '',
    '三步法的第一步是确定最接近的现有技术。',
  ].join('\n'))
  await writeFile(join(root, 'cards', 'rule', 'beta.md'), [
    '---',
    'id: "beta"',
    'type: "rule"',
    'title: "功能性特征的界定"',
    'domain_l2: "权利要求与说明书"',
    'source:',
    '  path: "/vault/beta.md"',
    '---',
    '# 功能性特征的界定',
    '',
    '功能性特征的认定标准。',
  ].join('\n'))
  const keyFile = join(root, 'local-key.json')
  await writeFile(keyFile, '{"apiKey":"secret"}')
  return { root, keyFile }
}

/** What a stubbed endpoint answers. */
interface EndpointScript {
  /** Vectors to answer an embedding batch with, by batch size. */
  readonly vectors?: (size: number) => unknown
  /** Rerank results, or an error to throw instead. */
  readonly rerank?: (size: number) => unknown
}

/**
 * Build a `fetch` double for the embedding endpoint.
 * @param script - what each endpoint answers.
 * @returns the double and the paths it was asked for.
 */
function endpoint(script: EndpointScript): {
  readonly fetchImpl: Fetcher
  readonly paths: string[]
  readonly bodies: Record<string, unknown>[]
} {
  const paths: string[] = []
  const bodies: Record<string, unknown>[] = []
  const fetchImpl: Fetcher = async (url, init) => {
    const path = new URL(url).pathname
    paths.push(path)
    const body = JSON.parse(init.body ?? '{}') as Record<string, unknown>
    bodies.push(body)
    if (path === '/v1/embeddings') {
      const size = Array.isArray(body['input']) ? body['input'].length : 0
      const data = script.vectors === undefined ? defaultVectors(size) : script.vectors(size)
      return { ok: true, status: 200, json: async () => data }
    }
    const documents = Array.isArray(body['documents']) ? body['documents'].length : 0
    return { ok: true, status: 200, json: async () => (script.rerank === undefined ? defaultRerank(documents) : script.rerank(documents)) }
  }
  return { fetchImpl, paths, bodies }
}

/**
 * The default embedding answer: the query points at the first axis, and the
 * corpus spreads along it in input order.
 * @param size - the batch size.
 * @returns the endpoint's body.
 */
function defaultVectors(size: number): unknown {
  if (size === 1) return { data: [{ embedding: [1, 0] }] }
  return { data: [{ embedding: [1, 0] }, { embedding: [0.9, 0.1] }].slice(0, size) }
}

/**
 * The default rerank answer: it prefers later candidates, so a spec can tell a
 * reranked order from a merged one.
 * @param size - the candidate count.
 * @returns the endpoint's body.
 */
function defaultRerank(size: number): unknown {
  return { results: Array.from({ length: size }, (_, index) => ({ index, relevance_score: 0.1 * index })) }
}

describe('zipVectors', () => {
  it('pairs every document with its vector', () => {
    expect(zipVectors(['a', 'b'], [[1], [2]])).toEqual([
      { doc: 'a', vector: [1] },
      { doc: 'b', vector: [2] },
    ])
  })

  it('ends the pairing when the server answers short', () => {
    expect(zipVectors(['a', 'b'], [[1]])).toEqual([{ doc: 'a', vector: [1] }])
  })
})

describe('suppressNearDuplicates', () => {
  /** Candidates named by their vector; `undefined` stands for a card the server skipped. */
  const entries = ['a', 'b', 'c']
  const vectors: Record<string, readonly number[] | undefined> = { a: [1, 0], b: [1, 0], c: [0, 1] }

  it('moves a candidate that repeats an earlier one behind the distinct ones', () => {
    const result = suppressNearDuplicates(entries, entry => entry, entry => vectors[entry], 0.97)
    expect(result.ordered).toEqual(['a', 'c', 'b'])
    expect(result.moved).toBe(1)
  })

  it('keeps a candidate the server answered no vector for', () => {
    const result = suppressNearDuplicates(entries, entry => entry, entry => (entry === 'b' ? undefined : vectors[entry]), 0.97)
    expect(result.ordered).toEqual(['a', 'b', 'c'])
    expect(result.moved).toBe(0)
  })
})

describe('createSearchService', () => {
  it('answers from keywords when the semantic stages are off', async () => {
    const { root } = await library()
    const service = createSearchService({ libraryRoot: root, plan: OFF, fetchImpl: endpoint({}).fetchImpl, minScore: undefined })
    const result = await service.search('三步法', 5)
    expect(result.mode).toBe('keyword')
    expect(result.hits.map(hit => hit.path)).toEqual(['cards/rule/alpha.md'])
    expect(result.hits[0]?.lawRefs).toEqual(['专利法第 22 条第 3 款'])
    expect(result.hits[0]?.sourcePath).toBe('/vault/alpha.md')
    expect(result.hits[0]?.snippet).toContain('三步法')
    expect(result.hits[0]?.matched).toEqual(['keyword'])
    expect(result.scanned).toBe(2)
    expect(result.degraded).toBe('未配置 embedding')
  })

  it('answers an empty query with no hits', async () => {
    const { root } = await library()
    const service = createSearchService({ libraryRoot: root, plan: OFF, fetchImpl: endpoint({}).fetchImpl, minScore: undefined })
    const result = await service.search('   ', 5)
    expect(result).toEqual({ query: '', mode: 'keyword', degraded: '', scanned: 2, deprecated: 0, duplicates: 0, hits: [] })
  })

  it('ranks a deprecated card after a live card it outscores', async () => {
    const { root } = await library()
    // The deprecated card repeats the query far more than the live one, so plain
    // BM25 puts it first; only the live-first rule can produce the order asserted here.
    await writeFile(join(root, 'cards', 'rule', 'gamma.md'), [
      '---',
      'id: "gamma"',
      'type: "rule"',
      'title: "三步法 三步法 三步法"',
      'domain_l2: "OA 答复"',
      'concept: "三步法"',
      'status: "deprecated"',
      'superseded_by: "cards/rule/alpha.md"',
      '---',
      '# 三步法 三步法 三步法',
      '',
      '三步法 三步法 三步法 三步法 三步法。',
    ].join('\n'))
    const service = createSearchService({ libraryRoot: root, plan: OFF, fetchImpl: endpoint({}).fetchImpl, minScore: undefined })
    const result = await service.search('三步法', 5)
    expect(result.scanned).toBe(3)
    expect(result.deprecated).toBe(1)
    expect(result.hits.map(hit => hit.path)).toEqual(['cards/rule/alpha.md', 'cards/rule/gamma.md'])
    expect(result.hits[1]?.status).toBe('deprecated')
    expect(result.hits[0]?.score).toBeLessThan(result.hits[1]?.score ?? 0)
  })

  it('keeps a place in the pool for each recall stage', async () => {
    // Sixty cards match the query on three rare words, and forty longer cards share no word
    // with it, which keeps those words rare enough for the keyword stage to fill the pool on
    // its own. One card shares no wording at all and is reachable only through the semantic
    // stage — the card a pool that compares the two stages' scores drops first. The pool is
    // read off the rerank request, which is the stage that receives it.
    const root = await mkdtemp(join(tmpdir(), 'dsh-ip-wiki-pool-'))
    created.push(root)
    await mkdir(join(root, 'cards', 'rule'), { recursive: true })
    const words = 'zqxalpha zqxbeta zqxgamma'
    await writeFile(join(root, 'cards', 'rule', 'aa-vector-only.md'), [
      '---',
      'id: "aa-vector-only"',
      'type: "rule"',
      'title: "与查询没有任何共同字面的卡片"',
      'domain_l2: "OA 答复"',
      'concept: "无关"',
      '---',
      '',
      '# 与查询没有任何共同字面的卡片',
      '',
      '这一段与查询没有共同字面，只可能被向量阶段找回来。',
    ].join('\n'))
    for (let index = 1; index <= 40; index += 1) {
      const id = `filler-${String(index).padStart(2, '0')}`
      await writeFile(join(root, 'cards', 'rule', `${id}.md`), [
        '---',
        `id: "${id}"`,
        'type: "rule"',
        `title: "填充卡片 ${String(index)}"`,
        'domain_l2: "OA 答复"',
        'concept: "填充"',
        '---',
        '',
        `# 填充卡片 ${String(index)}`,
        '',
        '这张卡片用较长的中文正文把平均文档长度抬起来，本身与查询没有任何共同词。',
      ].join('\n'))
    }
    for (let index = 1; index <= 60; index += 1) {
      const id = `kw-${String(index).padStart(2, '0')}`
      await writeFile(join(root, 'cards', 'rule', `${id}.md`), [
        '---',
        `id: "${id}"`,
        'type: "rule"',
        `title: "关键词卡片 ${String(index)}"`,
        'domain_l2: "OA 答复"',
        'concept: "关键词"',
        '---',
        '',
        `# 关键词卡片 ${String(index)}`,
        '',
        words,
      ].join('\n'))
    }
    const keyFile = join(root, 'local-key.json')
    await writeFile(keyFile, '{"apiKey":"secret"}')
    // The query points along the first axis; only the alphabetically first card — the
    // vector-only one — sits at cosine 0.5, and every other card is below the floor.
    const stub = endpoint({
      vectors: (size) => ({
        data: Array.from({ length: size }, (_, index) => ({
          embedding: size === 1 ? [1, 0] : (index === 0 ? [0.5, 0.866] : [0.1, 0.995]),
        })),
      }),
      rerank: size => ({ results: Array.from({ length: size }, (_, index) => ({ index, relevance_score: 1 })) }),
    })
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN_RERANK, apiKeyFile: keyFile },
      fetchImpl: stub.fetchImpl,
      minScore: undefined,
    })
    const result = await service.search(words, 20)
    expect(result.mode).toBe('rerank')
    const documents = stub.bodies.find(body => Array.isArray(body['documents']))?.['documents']
    expect(Array.isArray(documents)).toBe(true)
    expect((documents as string[]).some(document => document.startsWith('与查询没有任何共同字面的卡片'))).toBe(true)
  })

  it('finds what keywords miss by embedding the corpus', async () => {
    const { root, keyFile } = await library()
    const stub = endpoint({})
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN, apiKeyFile: keyFile },
      fetchImpl: stub.fetchImpl,
      minScore: undefined,
    })
    const result = await service.search('zzzz', 5)
    expect(result.mode).toBe('vector')
    expect(result.hits.map(hit => hit.path)).toEqual(['cards/rule/alpha.md', 'cards/rule/beta.md'])
    expect(result.hits[0]?.matched).toEqual(['vector'])
    expect(result.degraded).toBe('')
    expect(stub.paths).toEqual(['/v1/embeddings', '/v1/embeddings'])
  })

  it('reorders the merged candidates with the reranker', async () => {
    const { root, keyFile } = await library()
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN_RERANK, apiKeyFile: keyFile },
      fetchImpl: endpoint({ rerank: (size) => ({ results: Array.from({ length: size }, (_, index) => ({ index, relevance_score: index })) }) }).fetchImpl,
      minScore: undefined,
    })
    const result = await service.search('zzzz', 5)
    expect(result.mode).toBe('rerank')
    expect(result.hits[0]?.path).toBe('cards/rule/beta.md')
    expect(result.hits[0]?.matched).toEqual(['vector'])
  })

  it('keeps the merged order when the reranker omits a candidate', async () => {
    const { root, keyFile } = await library()
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN_RERANK, apiKeyFile: keyFile },
      fetchImpl: endpoint({ rerank: () => ({ results: [{ index: 1, relevance_score: 5 }] }) }).fetchImpl,
      minScore: undefined,
    })
    const result = await service.search('zzzz', 5)
    expect(result.mode).toBe('rerank')
    expect(result.hits[0]?.path).toBe('cards/rule/beta.md')
    expect(result.hits[1]?.path).toBe('cards/rule/alpha.md')
  })

  it('falls back to keywords when the endpoint refuses', async () => {
    const { root, keyFile } = await library()
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN, apiKeyFile: keyFile },
      fetchImpl: endpoint({ vectors: () => ({}) }).fetchImpl,
      minScore: undefined,
    })
    const result = await service.search('三步法', 5)
    expect(result.mode).toBe('keyword')
    expect(result.hits).toHaveLength(1)
    expect(result.degraded).toContain('嵌入调用失败，已退回关键词')
  })

  it('notes a short embedding answer instead of failing', async () => {
    const { root, keyFile } = await library()
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN, apiKeyFile: keyFile },
      fetchImpl: endpoint({ vectors: (size) => (size === 1 ? { data: [{ embedding: [1, 0] }] } : { data: [{ embedding: [1, 0] }] }) }).fetchImpl,
      minScore: undefined,
    })
    const result = await service.search('zzzz', 5)
    expect(result.mode).toBe('vector')
    expect(result.hits).toHaveLength(1)
    expect(result.degraded).toBe('嵌入服务只覆盖 1/2 张卡片')
  })

  it('keeps semantic order when the reranker refuses', async () => {
    const { root, keyFile } = await library()
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN_RERANK, apiKeyFile: keyFile },
      fetchImpl: endpoint({ rerank: () => ({}) }).fetchImpl,
      minScore: undefined,
    })
    const result = await service.search('zzzz', 5)
    expect(result.mode).toBe('vector')
    expect(result.degraded).toContain('精排调用失败，已按语义排序')
  })

  it('drops a non-Error failure into the same note', async () => {
    const { root, keyFile } = await library()
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN, apiKeyFile: keyFile },
      fetchImpl: async () => { throw '端点拒绝连接' },
      minScore: undefined,
    })
    const result = await service.search('三步法', 5)
    expect(result.degraded).toContain('端点拒绝连接')
  })

  it('answers the query vector case when the server returns none', async () => {
    const { root, keyFile } = await library()
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN, apiKeyFile: keyFile },
      fetchImpl: endpoint({ vectors: () => ({ data: [] }) }).fetchImpl,
      minScore: undefined,
    })
    const result = await service.search('三步法', 5)
    expect(result.mode).toBe('keyword')
    expect(result.degraded).toContain('嵌入服务没有返回查询向量')
  })

  it('honours the relevance floor', async () => {
    const { root, keyFile } = await library()
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN, apiKeyFile: keyFile },
      fetchImpl: endpoint({}).fetchImpl,
      minScore: 0.995,
    })
    const result = await service.search('zzzz', 5)
    expect(result.hits.map(hit => hit.path)).toEqual(['cards/rule/alpha.md'])
  })

  it('answers no hits when nothing matches and keywords are the only stage', async () => {
    const { root } = await library()
    const service = createSearchService({ libraryRoot: root, plan: OFF, fetchImpl: endpoint({}).fetchImpl, minScore: undefined })
    const result = await service.search('qqqq', 5)
    expect(result.hits).toEqual([])
  })

  it('describes semantic availability with the reason when it is off', async () => {
    const { root } = await library()
    const service = createSearchService({ libraryRoot: root, plan: OFF, fetchImpl: endpoint({}).fetchImpl, minScore: undefined })
    await expect(service.describe()).resolves.toEqual({ semantic: false, reason: '未配置 embedding', embedModel: '' })
  })

  it('describes semantic availability when the key is there', async () => {
    const { root, keyFile } = await library()
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN, apiKeyFile: keyFile },
      fetchImpl: endpoint({}).fetchImpl,
      minScore: undefined,
    })
    await expect(service.describe()).resolves.toEqual({ semantic: true, reason: '', embedModel: DEFAULT_EMBED_MODEL })
  })

  it('names the key file it could not read', async () => {
    const { root } = await library()
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN, apiKeyFile: join(root, 'missing.json') },
      fetchImpl: endpoint({}).fetchImpl,
      minScore: undefined,
    })
    const status = await service.describe()
    expect(status.semantic).toBe(false)
    expect(status.reason).toContain('未读到本地 API key')
  })

  it('still answers keywords when the key file is missing', async () => {
    const { root } = await library()
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN, apiKeyFile: join(root, 'missing.json') },
      fetchImpl: endpoint({}).fetchImpl,
      minScore: undefined,
    })
    const result = await service.search('三步法', 5)
    expect(result.mode).toBe('keyword')
    expect(result.hits).toHaveLength(1)
    expect(result.degraded).toContain('未读到本地 API key')
  })

  it('reaches the default floor when the caller sets none', async () => {
    const { root, keyFile } = await library()
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN, apiKeyFile: keyFile },
      fetchImpl: endpoint({}).fetchImpl,
      minScore: undefined,
    })
    const result = await service.search('zzzz', 5)
    expect(result.hits).toHaveLength(2)
  })

  it('honours the limit', async () => {
    const { root, keyFile } = await library()
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN, apiKeyFile: keyFile },
      fetchImpl: endpoint({}).fetchImpl,
      minScore: undefined,
    })
    await expect(service.search('zzzz', 1)).resolves.toMatchObject({ hits: [{ path: 'cards/rule/alpha.md' }] })
  })

  it('breaks a rerank score tie by path', async () => {
    const { root, keyFile } = await library()
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN_RERANK, apiKeyFile: keyFile },
      fetchImpl: endpoint({ rerank: (size) => ({ results: Array.from({ length: size }, (_, index) => ({ index, relevance_score: 1 })) }) }).fetchImpl,
      minScore: undefined,
    })
    const result = await service.search('zzzz', 5)
    expect(result.mode).toBe('rerank')
    expect(result.hits.map(hit => hit.path)).toEqual(['cards/rule/alpha.md', 'cards/rule/beta.md'])
  })

  it('truncates a long card before it reaches a model', async () => {
    const { root, keyFile } = await library()
    await writeFile(join(root, 'cards', 'rule', 'long.md'), [
      '---',
      'id: "long"',
      'type: "rule"',
      'title: "很长的卡片"',
      '---',
      '# 很长的卡片',
      '',
      '很长的正文。'.repeat(400),
    ].join('\n'))
    const stub = endpoint({})
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN, apiKeyFile: keyFile },
      fetchImpl: stub.fetchImpl,
      minScore: undefined,
    })
    const result = await service.search('zzzz', 5)
    expect(result.scanned).toBe(3)
    const inputs = stub.bodies.filter(body => Array.isArray(body['input']))
    const corpusInput = inputs[inputs.length - 1]?.['input']
    expect(Array.isArray(corpusInput)).toBe(true)
    for (const text of corpusInput as string[]) expect(text.length).toBeLessThanOrEqual(1200)
  })

  it('notes a non-Error rerank failure', async () => {
    const { root, keyFile } = await library()
    const failing: Fetcher = async (url) => {
      if (new URL(url).pathname === '/v1/rerank') throw '精排端点拒绝连接'
      return { ok: true, status: 200, json: async () => ({ data: [{ embedding: [1, 0] }, { embedding: [0.9, 0.1] }] }) }
    }
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN_RERANK, apiKeyFile: keyFile },
      fetchImpl: failing,
      minScore: undefined,
    })
    const result = await service.search('zzzz', 5)
    expect(result.mode).toBe('vector')
    expect(result.degraded).toContain('精排端点拒绝连接')
  })

  it('reuses a cached vector for an unchanged card and drops a changed one', async () => {
    const { root, keyFile } = await library()
    const stub = endpoint({})
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN, apiKeyFile: keyFile },
      fetchImpl: stub.fetchImpl,
      minScore: undefined,
    })
    await service.search('三步法', 5)
    const first = stub.paths.length
    await service.search('三步法', 5)
    expect(stub.paths.length).toBe(first + 1)
    await writeFile(join(root, 'cards', 'rule', 'beta.md'), [
      '---',
      'id: "beta"',
      'type: "rule"',
      'title: "功能性特征的界定（改）"',
      '---',
      '# 改过的正文',
    ].join('\n'))
    await service.search('三步法', 5)
    expect(stub.paths.length).toBe(first + 3)
  })

  it('moves a card that repeats an earlier answer behind the distinct one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ip-wiki-dup-'))
    created.push(root)
    await mkdir(join(root, 'cards', 'rule'), { recursive: true })
    for (const [id, title] of [['alpha', '重复的卡'], ['beta', '重复的卡改写'], ['gamma', '另一张卡']] as const) {
      await writeFile(join(root, 'cards', 'rule', `${id}.md`), [
        '---', `id: "${id}"`, 'type: "rule"', `title: "${title}"`, '---', '', `# ${title}`, '', '正文。',
      ].join('\n'))
    }
    const keyFile = join(root, 'local-key.json')
    await writeFile(keyFile, '{"apiKey":"secret"}')
    // Two cards embed identically and the third is only loosely related to the query, so
    // nothing but the near-duplicate rule can order the third ahead of the second.
    const stub: Fetcher = async (url, init) => {
      const body = JSON.parse(init.body ?? '{}') as Record<string, unknown>
      const inputs = (body['input'] ?? []) as string[]
      const data = inputs.map(text => ({ embedding: text.startsWith('另一张卡') ? [0.6, 0.8] : [1, 0] }))
      return { ok: true, status: 200, json: async () => ({ data }) }
    }
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN, apiKeyFile: keyFile },
      fetchImpl: stub,
      minScore: undefined,
    })
    const result = await service.search('zzzz', 5)
    expect(result.hits.map(hit => hit.path)).toEqual([
      'cards/rule/alpha.md',
      'cards/rule/gamma.md',
      'cards/rule/beta.md',
    ])
    expect(result.duplicates).toBe(1)
  })

  it('keeps a live repeat ahead of a deprecated card', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ip-wiki-dup-retired-'))
    created.push(root)
    await mkdir(join(root, 'cards', 'rule'), { recursive: true })
    await writeFile(join(root, 'cards', 'rule', 'alpha.md'), [
      '---', 'id: "alpha"', 'type: "rule"', 'title: "现行卡"', '---', '', '# 现行卡', '', '正文。',
    ].join('\n'))
    await writeFile(join(root, 'cards', 'rule', 'beta.md'), [
      '---', 'id: "beta"', 'type: "rule"', 'title: "现行改写"', '---', '', '# 现行改写', '', '正文。',
    ].join('\n'))
    await writeFile(join(root, 'cards', 'rule', 'old.md'), [
      '---', 'id: "old"', 'type: "rule"', 'title: "已废弃卡"', 'status: "deprecated"', '---', '', '# 已废弃卡', '', '正文。',
    ].join('\n'))
    const keyFile = join(root, 'local-key.json')
    await writeFile(keyFile, '{"apiKey":"secret"}')
    // All three embed the same way, so the live repeat is the only thing the suppression
    // may move — and it must not move behind the deprecated card.
    const stub: Fetcher = async (url, init) => {
      const body = JSON.parse(init.body ?? '{}') as Record<string, unknown>
      const inputs = (body['input'] ?? []) as string[]
      return { ok: true, status: 200, json: async () => ({ data: inputs.map(() => ({ embedding: [1, 0] })) }) }
    }
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN, apiKeyFile: keyFile },
      fetchImpl: stub,
      minScore: undefined,
    })
    const result = await service.search('zzzz', 5)
    expect(result.hits.map(hit => hit.path)).toEqual([
      'cards/rule/alpha.md',
      'cards/rule/beta.md',
      'cards/rule/old.md',
    ])
    expect(result.deprecated).toBe(1)
    expect(result.duplicates).toBe(1)
  })

  it('hands the reranker a pool of forty candidates, not twenty', async () => {
    // Forty-five cards match the query's rare words, so both stages answer with more
    // candidates than the pool holds; the rerank request is where the pool size shows.
    const root = await mkdtemp(join(tmpdir(), 'dsh-ip-wiki-pool-size-'))
    created.push(root)
    await mkdir(join(root, 'cards', 'rule'), { recursive: true })
    for (let index = 1; index <= 45; index += 1) {
      const id = `kw-${String(index).padStart(2, '0')}`
      await writeFile(join(root, 'cards', 'rule', `${id}.md`), [
        '---', `id: "${id}"`, 'type: "rule"', `title: "关键词卡片 ${String(index)}"`, '---', '',
        `# 关键词卡片 ${String(index)}`, '', 'zqxalpha zqxbeta zqxgamma',
      ].join('\n'))
    }
    const keyFile = join(root, 'local-key.json')
    await writeFile(keyFile, '{"apiKey":"secret"}')
    const stub = endpoint({
      vectors: size => ({ data: Array.from({ length: size }, () => ({ embedding: [1, 0] })) }),
      rerank: size => ({ results: Array.from({ length: size }, (_, index) => ({ index, relevance_score: 1 })) }),
    })
    const service = createSearchService({
      libraryRoot: root,
      plan: { ...PLAN_RERANK, apiKeyFile: keyFile },
      fetchImpl: stub.fetchImpl,
      minScore: undefined,
    })
    const result = await service.search('zqxalpha zqxbeta zqxgamma', 5)
    expect(result.mode).toBe('rerank')
    const rerankBody = stub.bodies.find(body => Array.isArray(body['documents']))
    expect((rerankBody?.['documents'] as string[] | undefined)).toHaveLength(40)
  })
})
