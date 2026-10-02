/**
 * The local embedding and rerank client.
 *
 * The endpoint is an OpenAI-compatible server on loopback (`/v1/embeddings`,
 * `/v1/rerank`). The key is read from a file outside the library, never from the
 * card library and never from this package, so a knowledge base stays shareable.
 * Every response is read field by field: a server that answers something else
 * must fail with a message naming what was wrong, not feed a wrong vector on.
 * @module dsh-ip-wiki/host/embeddings
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Fetcher } from '../shared/wire'

/** Default loopback endpoint of the local inference server. */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:8000'

/** Default embedding model id, as that endpoint spells it. */
export const DEFAULT_EMBED_MODEL = 'bge-m3-mlx-fp16'

/** Default rerank model id, as that endpoint spells it. */
export const DEFAULT_RERANK_MODEL = 'BAAI-bge-reranker-v2-m3-mlx-fp16'

/** Default per-request timeout. */
export const DEFAULT_TIMEOUT_MS = 20_000

/** Default location of the local key file, outside any library. */
export const DEFAULT_KEY_FILE = join(homedir(), '.dsh', 'ip-wiki', 'config.json')

/** The embedding settings a row may carry. */
export interface EmbeddingConfig {
  /** Whether semantic stages may run at all; defaults to true. */
  readonly enabled?: boolean
  /** Endpoint base URL; defaults to {@link DEFAULT_BASE_URL}. */
  readonly baseUrl?: string
  /** Embedding model id. */
  readonly embedModel?: string
  /** Rerank model id. */
  readonly rerankModel?: string
  /** File holding `{"apiKey": "…"}`; defaults to {@link DEFAULT_KEY_FILE}. */
  readonly apiKeyFile?: string
  /** Per-request timeout in milliseconds. */
  readonly timeoutMs?: number
  /** Whether to rerank the merged candidates; defaults to true. */
  readonly rerank?: boolean
}

/** A resolved plan: either semantic stages are on with concrete settings, or off with a reason. */
export type EmbeddingPlan =
  | { readonly enabled: true; readonly baseUrl: string; readonly embedModel: string; readonly rerankModel: string; readonly apiKeyFile: string; readonly timeoutMs: number; readonly rerank: boolean }
  | { readonly enabled: false; readonly reason: string }

/**
 * Resolve the embedding settings, applying every default in one place.
 * @param config - the row's `embedding` block, when it has one.
 * @returns the plan; `enabled: false` carries the reason to show the user.
 */
export function resolveEmbeddingPlan(config: EmbeddingConfig | undefined): EmbeddingPlan {
  if (config === undefined) {
    return { enabled: false, reason: '未配置 embedding（config.embedding 缺失）' }
  }
  if (config.enabled === false) {
    return { enabled: false, reason: 'embedding 已按配置关闭' }
  }
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, '')
  return {
    enabled: true,
    baseUrl,
    embedModel: config.embedModel ?? DEFAULT_EMBED_MODEL,
    rerankModel: config.rerankModel ?? DEFAULT_RERANK_MODEL,
    apiKeyFile: config.apiKeyFile ?? DEFAULT_KEY_FILE,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    rerank: config.rerank ?? true,
  }
}

/**
 * Read the local key file.
 * @param file - path of the file holding `{"apiKey": "…"}`.
 * @returns the key, or `undefined` when the file is absent, unreadable, or malformed.
 */
export async function readApiKey(file: string): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const key = (parsed as Record<string, unknown>)['apiKey']
    return typeof key === 'string' && key !== '' ? key : undefined
  } catch {
    // A missing or unreadable key file disables only the semantic stages; the
    // keyword path stays available, which is why this is not an error.
    return undefined
  }
}

/** One resolved embedding client. */
export interface Embedder {
  /**
   * Embed a batch of texts, in input order.
   * @param texts - the texts to embed.
   * @returns the vectors the server answered with; the caller decides what a
   * shorter answer than the batch means.
   */
  embed(texts: readonly string[]): Promise<number[][]>
  /**
   * Score documents against a query.
   * @param query - the query text.
   * @param documents - the documents to score.
   * @returns one entry per index the server scored, in its own order.
   */
  rerank(query: string, documents: readonly string[]): Promise<readonly { readonly index: number; readonly score: number }[]>
}

/** Read one value as an object, or fail naming what was expected. */
function objectOf(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`dsh-ip-wiki: ${what} is not an object`)
  }
  return value as Record<string, unknown>
}

/** Read one vector of numbers. */
function vectorOf(value: unknown, what: string): number[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'number')) {
    throw new Error(`dsh-ip-wiki: ${what} is not a list of numbers`)
  }
  return value.filter((item): item is number => typeof item === 'number')
}

/**
 * Build the client for one resolved plan.
 * @param plan - the resolved settings.
 * @param apiKey - the key to send.
 * @param fetchImpl - the `fetch` implementation.
 * @returns the embedder.
 */
export function createEmbedder(
  plan: Extract<EmbeddingPlan, { enabled: true }>,
  apiKey: string,
  fetchImpl: Fetcher,
): Embedder {
  async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetchImpl(`${plan.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(plan.timeoutMs),
    })
    if (!response.ok) throw new Error(`dsh-ip-wiki: ${path} answered HTTP ${String(response.status)}`)
    return objectOf(await response.json(), `${path} response`)
  }
  return {
    async embed(texts) {
      const payload = await post('/v1/embeddings', { model: plan.embedModel, input: [...texts] })
      const data = payload['data']
      if (!Array.isArray(data)) {
        throw new Error('dsh-ip-wiki: /v1/embeddings answered without a data list')
      }
      return data.map((entry, index) =>
        vectorOf(objectOf(entry, 'embedding entry')['embedding'], `embedding ${String(index)}`))
    },
    async rerank(query, documents) {
      const payload = await post('/v1/rerank', { model: plan.rerankModel, query, documents: [...documents] })
      const results = payload['results']
      if (!Array.isArray(results)) {
        throw new Error('dsh-ip-wiki: /v1/rerank answered without a results list')
      }
      return results.map((entry): { index: number; score: number } => {
        const record = objectOf(entry, 'rerank entry')
        const index = record['index']
        const score = record['relevance_score']
        if (typeof index !== 'number' || typeof score !== 'number') {
          throw new Error('dsh-ip-wiki: /v1/rerank entry carries no index or score')
        }
        return { index, score }
      })
    },
  }
}

/**
 * Cosine similarity of two vectors.
 * @param left - first vector.
 * @param right - second vector.
 * @returns the similarity, compared position by position; a position only one
 * side carries counts as a zero on the other, and a zero-length vector scores
 * zero rather than NaN.
 */
export function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}
