/** Keyword retrieval and the local embedding client: the branches that decide ranking. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BASE_URL,
  DEFAULT_EMBED_MODEL,
  DEFAULT_KEY_FILE,
  DEFAULT_RERANK_MODEL,
  cosine,
  createEmbedder,
  readApiKey,
  resolveEmbeddingPlan,
  type EmbeddingPlan,
} from '../src/host/embeddings'
import { buildIndex, searchIndex, snippet, tokenize } from '../src/host/retrieval'
import type { Fetcher } from '../src/shared/wire'

/** A resolved plan the client tests build on. */
const PLAN: Extract<EmbeddingPlan, { enabled: true }> = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:8000',
  embedModel: DEFAULT_EMBED_MODEL,
  rerankModel: DEFAULT_RERANK_MODEL,
  apiKeyFile: DEFAULT_KEY_FILE,
  timeoutMs: 1000,
  rerank: true,
}

/**
 * Build a `fetch` double that answers one JSON body, or fails.
 * @param answer - the body to answer with, or the status to fail with.
 * @returns the double and the request bodies it received.
 */
function endpoint(answer: { body?: unknown; status?: number }): {
  readonly fetchImpl: Fetcher
  readonly bodies: Record<string, unknown>[]
  readonly urls: string[]
} {
  const bodies: Record<string, unknown>[] = []
  const urls: string[] = []
  const fetchImpl: Fetcher = async (url, init) => {
    urls.push(url)
    bodies.push(JSON.parse(init.body ?? '{}') as Record<string, unknown>)
    const status = answer.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => answer.body,
    }
  }
  return { fetchImpl, bodies, urls }
}

describe('tokenize', () => {
  it('reads Latin words whole and lowercased', () => {
    expect(tokenize('Bolar Exception')).toEqual(['bolar', 'exception'])
  })

  it('reads CJK characters and their adjacent pairs', () => {
    expect(tokenize('三步法')).toEqual(['三', '三步', '步', '步法', '法'])
  })

  it('reads a single CJK character', () => {
    expect(tokenize('权')).toEqual(['权'])
  })

  it('splits on punctuation and mixes scripts', () => {
    expect(tokenize('Bolar例外、三步法')).toEqual([
      'bolar', '例', '例外', '外', '三', '三步', '步', '步法', '法',
    ])
  })

  it('reads an empty string as no tokens', () => {
    expect(tokenize('   ')).toEqual([])
  })
})

describe('buildIndex and searchIndex', () => {
  const docs = [
    { path: 'a.md', text: '三步法 创造性判断' },
    { path: 'b.md', text: '功能性特征 外观设计' },
    { path: 'c.md', text: '三步法 三步法' },
  ]

  it('counts document frequency and mean length', () => {
    const index = buildIndex(docs)
    expect(index.docs).toHaveLength(3)
    expect(index.df['三步']).toBe(2)
    expect(index.averageLength).toBeGreaterThan(1)
  })

  it('keeps a non-zero mean length for an empty corpus', () => {
    expect(buildIndex([]).averageLength).toBe(1)
  })

  it('ranks the more relevant document first', () => {
    const hits = searchIndex(buildIndex(docs), '功能性特征', 5)
    expect(hits[0]?.doc.path).toBe('b.md')
  })

  it('scores a repeated term above a single one', () => {
    const hits = searchIndex(buildIndex(docs), '三步法', 5)
    expect(hits.map(hit => hit.doc.path)).toEqual(['c.md', 'a.md'])
  })

  it('answers an empty query with no hits', () => {
    expect(searchIndex(buildIndex(docs), '   ', 5)).toEqual([])
  })

  it('answers a term no document carries with no hits', () => {
    expect(searchIndex(buildIndex(docs), '商标', 5)).toEqual([])
  })

  it('does not let one shared character pull in an unrelated card', () => {
    expect(searchIndex(buildIndex(docs), '商标注册', 5)).toEqual([])
  })

  it('still answers a one-character query', () => {
    // c.md repeats the term, so it scores above a.md, which carries it once.
    expect(searchIndex(buildIndex(docs), '步', 5).map(hit => hit.doc.path)).toEqual(['c.md', 'a.md'])
  })

  it('answers a one-character query no document carries with no hits', () => {
    expect(searchIndex(buildIndex(docs), '册', 5)).toEqual([])
  })

  it('breaks a score tie by path', () => {
    const tied = [
      { path: 'z.md', text: '三步法' },
      { path: 'a.md', text: '三步法' },
    ]
    expect(searchIndex(buildIndex(tied), '三步法', 5).map(hit => hit.doc.path)).toEqual(['a.md', 'z.md'])
  })

  it('honours the limit', () => {
    expect(searchIndex(buildIndex(docs), '三步法', 1)).toHaveLength(1)
  })
})

describe('snippet', () => {
  const text = '# 标题\n\n第一段没有关键词。\n第二段讲三步法的适用。\n第三段收尾。'

  it('quotes the line that matches the query', () => {
    expect(snippet(text, '三步法', 100)).toBe('第二段讲三步法的适用。')
  })

  it('falls back to the first line when nothing matches', () => {
    expect(snippet(text, '商标', 100)).toBe('# 标题')
  })

  it('answers empty text with empty text', () => {
    expect(snippet('', '三步法', 100)).toBe('')
  })

  it('truncates a long line', () => {
    const long = `${'很长的一段文字'.repeat(30)}三步法`
    const drawn = snippet(long, '三步法', 20)
    expect(drawn).toHaveLength(21)
    expect(drawn.endsWith('…')).toBe(true)
  })
})

describe('resolveEmbeddingPlan', () => {
  it('disables the semantic stages when the row configures none', () => {
    expect(resolveEmbeddingPlan(undefined)).toEqual({ enabled: false, reason: '未配置 embedding（config.embedding 缺失）' })
  })

  it('honours an explicit off switch', () => {
    expect(resolveEmbeddingPlan({ enabled: false })).toEqual({ enabled: false, reason: 'embedding 已按配置关闭' })
  })

  it('applies every default in one place', () => {
    expect(resolveEmbeddingPlan({})).toEqual({
      enabled: true,
      baseUrl: DEFAULT_BASE_URL,
      embedModel: DEFAULT_EMBED_MODEL,
      rerankModel: DEFAULT_RERANK_MODEL,
      apiKeyFile: DEFAULT_KEY_FILE,
      timeoutMs: 20_000,
      rerank: true,
    })
  })

  it('reads explicit settings and strips trailing slashes from the base URL', () => {
    expect(resolveEmbeddingPlan({
      baseUrl: 'http://127.0.0.1:9000///',
      embedModel: 'custom-embed',
      rerankModel: 'custom-rerank',
      apiKeyFile: '/tmp/key.json',
      timeoutMs: 5,
      rerank: false,
    })).toEqual({
      enabled: true,
      baseUrl: 'http://127.0.0.1:9000',
      embedModel: 'custom-embed',
      rerankModel: 'custom-rerank',
      apiKeyFile: '/tmp/key.json',
      timeoutMs: 5,
      rerank: false,
    })
  })
})

describe('readApiKey', () => {
  it('reads the key from the documented file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ip-wiki-key-'))
    const file = join(dir, 'config.json')
    await writeFile(file, '{"apiKey":"secret"}')
    await expect(readApiKey(file)).resolves.toBe('secret')
    await rm(dir, { recursive: true, force: true })
  })

  it('answers nothing for a missing file', async () => {
    await expect(readApiKey('/definitely/not/there.json')).resolves.toBeUndefined()
  })

  it('answers nothing for malformed JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ip-wiki-key-'))
    const file = join(dir, 'config.json')
    await writeFile(file, 'not json')
    await expect(readApiKey(file)).resolves.toBeUndefined()
    await rm(dir, { recursive: true, force: true })
  })

  it('answers nothing for a payload that is not an object', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ip-wiki-key-'))
    const file = join(dir, 'config.json')
    await writeFile(file, '[1,2]')
    await expect(readApiKey(file)).resolves.toBeUndefined()
    await rm(dir, { recursive: true, force: true })
  })

  it('answers nothing for an object without a usable key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ip-wiki-key-'))
    const file = join(dir, 'config.json')
    await writeFile(file, '{"other":1}')
    await expect(readApiKey(file)).resolves.toBeUndefined()
    await writeFile(file, '{"apiKey":""}')
    await expect(readApiKey(file)).resolves.toBeUndefined()
    await rm(dir, { recursive: true, force: true })
  })
})

describe('createEmbedder', () => {
  it('embeds in input order and sends the configured model', async () => {
    const stub = endpoint({ body: { data: [{ embedding: [1, 2] }, { embedding: [3, 4] }] } })
    const embedder = createEmbedder(PLAN, 'secret', stub.fetchImpl)
    await expect(embedder.embed(['a', 'b'])).resolves.toEqual([[1, 2], [3, 4]])
    expect(stub.urls[0]).toBe('http://127.0.0.1:8000/v1/embeddings')
    expect(stub.bodies[0]).toEqual({ model: DEFAULT_EMBED_MODEL, input: ['a', 'b'] })
  })

  it('fails loud when the endpoint refuses', async () => {
    const stub = endpoint({ status: 401 })
    await expect(createEmbedder(PLAN, 'secret', stub.fetchImpl).embed(['a']))
      .rejects.toThrow('/v1/embeddings answered HTTP 401')
  })

  it('fails loud when the body is not an object', async () => {
    const stub = endpoint({ body: 42 })
    await expect(createEmbedder(PLAN, 'secret', stub.fetchImpl).embed(['a']))
      .rejects.toThrow('/v1/embeddings response is not an object')
  })

  it('fails loud when the body carries no data list', async () => {
    const stub = endpoint({ body: {} })
    await expect(createEmbedder(PLAN, 'secret', stub.fetchImpl).embed(['a']))
      .rejects.toThrow('answered without a data list')
  })

  it('fails loud when a vector is not a list of numbers', async () => {
    const stub = endpoint({ body: { data: [{ embedding: 'nope' }] } })
    await expect(createEmbedder(PLAN, 'secret', stub.fetchImpl).embed(['a']))
      .rejects.toThrow('embedding 0 is not a list of numbers')
  })

  it('reads rerank scores with their indices', async () => {
    const stub = endpoint({ body: { results: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.1 }] } })
    const embedder = createEmbedder(PLAN, 'secret', stub.fetchImpl)
    await expect(embedder.rerank('q', ['a', 'b'])).resolves.toEqual([
      { index: 1, score: 0.9 },
      { index: 0, score: 0.1 },
    ])
    expect(stub.bodies[0]).toEqual({ model: DEFAULT_RERANK_MODEL, query: 'q', documents: ['a', 'b'] })
  })

  it('fails loud when rerank carries no results list', async () => {
    const stub = endpoint({ body: {} })
    await expect(createEmbedder(PLAN, 'secret', stub.fetchImpl).rerank('q', ['a']))
      .rejects.toThrow('answered without a results list')
  })

  it('fails loud when a rerank entry carries no index or score', async () => {
    const stub = endpoint({ body: { results: [{ index: 0 }] } })
    await expect(createEmbedder(PLAN, 'secret', stub.fetchImpl).rerank('q', ['a']))
      .rejects.toThrow('carries no index or score')
  })
})

describe('cosine', () => {
  it('scores identical directions at one', () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1, 10)
  })

  it('scores orthogonal directions at zero', () => {
    expect(cosine([1, 0], [0, 1])).toBe(0)
  })

  it('scores a zero vector at zero rather than NaN', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0)
    expect(cosine([1, 1], [0, 0])).toBe(0)
  })

  it('treats a position only the left side carries as zero on the right', () => {
    // The lone 9 counts toward no shared direction, so the cosine is 1 over the
    // left vector's own length, and the score is the same read either way round.
    expect(cosine([1, 0, 9], [1, 0])).toBeCloseTo(1 / Math.sqrt(82), 10)
    expect(cosine([1, 0], [1, 0, 9])).toBeCloseTo(cosine([1, 0, 9], [1, 0]), 10)
  })
})
