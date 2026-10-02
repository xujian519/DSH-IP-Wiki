/**
 * P1 acceptance: the two first-phase scenarios asked as real questions, run through
 * the real pipeline against the real library and the real local endpoint.
 *
 * Skipped unless `DSH_IP_WIKI_EVAL=1`, because it needs the local inference server
 * and the user's card library: it is the measurement, not part of the unit gate.
 * The bars are declared here before the first run so the number is a result, not a
 * rationalization: every question must have its card in the top three, and most
 * must be first.
 */
import { describe, expect, it } from 'vitest'
import { resolveEmbeddingPlan } from '../src/host/embeddings'
import { createSearchService } from '../src/host/search'
import { answers, CASES } from './p1-cases'

/** The library under measurement. */
const LIBRARY = '/Users/xujian/projects/LLM-wiki-card'

/** Where the local endpoint's key lives. */
const KEY_FILE = '/Users/xujian/.dsh/ip-wiki/config.json'

/** Declared before the first run: the card must be in the top three this often. */
const REQUIRED_TOP3 = 18

/** Declared before the first run: the card must be first this often. */
const REQUIRED_TOP1 = 14

describe.skipIf(process.env['DSH_IP_WIKI_EVAL'] !== '1')('P1 retrieval acceptance', () => {
  it('reaches the right card for the first-phase questions', async () => {
    const service = createSearchService({
      libraryRoot: LIBRARY,
      plan: resolveEmbeddingPlan({
        enabled: true,
        baseUrl: 'http://127.0.0.1:8000',
        embedModel: 'bge-m3-mlx-fp16',
        rerankModel: 'BAAI-bge-reranker-v2-m3-mlx-fp16',
        apiKeyFile: KEY_FILE,
        // The corpus is 1,137 cards since the Wiki import, and the vector cache lives in
        // process memory, so the run's first query embeds the whole library (measured
        // 163 s). The timeout has to cover that cold start or every query measures the
        // keyword fallback instead of the pipeline.
        timeoutMs: 240_000,
        rerank: true,
      }),
      fetchImpl: globalThis.fetch,
      minScore: undefined,
    })
    const rows: string[] = []
    let top1 = 0
    let top3 = 0
    for (const [index, case_] of CASES.entries()) {
      const result = await service.search(case_.question, 5)
      const rank = result.hits.findIndex(hit => answers(case_, hit.path))
      if (rank === 0) top1 += 1
      if (rank >= 0 && rank < 3) top3 += 1
      const top = result.hits[0]
      rows.push([
        `| ${String(index + 1)} | ${case_.scenario} | ${case_.question}`,
        `| ${rank < 0 ? '未命中' : `第 ${String(rank + 1)}`} | ${result.mode} | ${top === undefined ? '—' : top.title.slice(0, 46)} |`,
      ].join(''))
    }
    console.log([
      '',
      '| # | 场景 | 问题 | 答案卡片排名 | 检索方式 | 首位命中 |',
      '| --- | --- | --- | --- | --- | --- |',
      ...rows,
      '',
      `命中@1 = ${String(top1)}/20，命中@3 = ${String(top3)}/20`,
      '',
    ].join('\n'))
    expect(top3).toBeGreaterThanOrEqual(REQUIRED_TOP3)
    expect(top1).toBeGreaterThanOrEqual(REQUIRED_TOP1)
  }, 600_000)
})
