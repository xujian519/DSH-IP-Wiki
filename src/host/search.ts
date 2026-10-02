/**
 * The retrieval pipeline: keywords, then local embeddings, then a local reranker,
 * each stronger stage optional.
 *
 * The stages are ordered by cost, and every stronger stage degrades into the
 * weaker one instead of failing the request: a machine with no key file, no
 * running endpoint, or a model that answers something unexpected still searches,
 * and the result says which stage actually ran and why a stronger one did not.
 *
 * Nothing here writes to the library. The vector cache lives in process memory and
 * is keyed by the content it was built from, so editing a card invalidates its
 * vector without a rebuild step and the knowledge base stays exactly as the user
 * left it.
 *
 * The answer list is ordered by relevance with two rules on top of it: a card another
 * card replaced ranks after every live card, and a card that repeats one already in the
 * list ranks after the distinct ones. Both are reported as counts so a caller can say
 * why the list is not strictly score-ordered.
 * @module dsh-ip-wiki/host/search
 */
import { createHash } from 'node:crypto'
import type { CardDocument, SearchHit, SearchMode, SearchResult, SearchStatus } from '../shared/card'
import type { Fetcher } from '../shared/wire'
import { createEmbedder, cosine, readApiKey, type Embedder, type EmbeddingPlan } from './embeddings'
import { listCardDocuments } from './library'
import { buildIndex, searchIndex, snippet, type RetrievalDoc, type ScoredDoc } from './retrieval'

/**
 * How many candidates each recall stage hands to the next.
 *
 * Measured on the real 1,137-card library: one of the twenty acceptance questions
 * reaches its card at keyword rank 20 and semantic rank 19, and a twenty-place pool
 * drops it before the reranker can see it, while a forty-place pool puts it second.
 * The extra places cost one longer rerank call and no extra embedding.
 */
const CANDIDATES = 40

/**
 * How many places in the pool each stage keeps for itself.
 *
 * The two stages score on different scales — BM25 normalized by the best hit, against
 * a cosine — so once the corpus is large one stage can outscore the other on nearly
 * every candidate it found. Without a guaranteed share, a card the semantic stage ranks
 * fifth can miss a twenty-place pool entirely, and the reranker never sees it.
 */
const STAGE_SLOTS = CANDIDATES / 2

/** How many characters of a card the embedding model sees. */
const EMBED_CHARS = 1200

/** How many characters of a card the reranker sees. */
const RERANK_CHARS = 1200

/** How many characters of a card a hit quotes. */
const SNIPPET_CHARS = 180

/**
 * How alike two candidates may be before the later one is moved behind the distinct ones.
 *
 * A knowledge base reaches "one answer, several cards" two ways: the same question
 * reworded, and one page split into fragments. Measured on the real library, reworded
 * cards of one question sit at cosine 0.97-1.00 while two different fragments of one
 * page reach only 0.87-0.96, because a fragment carries its own section text. So this
 * threshold takes the rewording out of an answer list without hiding a distinct section.
 */
const DUPLICATE_COSINE = 0.97

/** Default relevance floor for semantic candidates, before reranking. */
export const DEFAULT_MIN_SCORE = 0.25

/** One card in the corpus, carrying everything the pipeline needs. */
interface CorpusDoc extends RetrievalDoc {
  /** The parsed card. */
  readonly card: CardDocument
}

/** One candidate on its way to the hit list. */
interface Candidate {
  /** The card. */
  readonly doc: CorpusDoc
  /** Its current score, replaced by the reranker's when there is one. */
  score: number
  /** The stages that found or ranked it. */
  readonly matched: SearchMode[]
}

/** The retrieval service both the routes and the agent tools call. */
export interface SearchService {
  /**
   * Search the library.
   * @param query - the query text.
   * @param limit - the greatest number of hits to return.
   * @returns the hits, the stage that produced the order, and any degradation.
   */
  search(query: string, limit: number): Promise<SearchResult>
  /**
   * Report whether semantic retrieval is available.
   * @returns the availability, its reason, and the model.
   */
  describe(): Promise<SearchStatus>
}

/**
 * Pair embedded vectors with the documents they belong to.
 * @param docs - the documents that were submitted, in order.
 * @param vectors - whatever the server answered with, in order.
 * @returns one pair per document the server actually answered for; a shorter
 * answer than the batch ends the pairing, so those cards simply score no
 * semantic match this round.
 */
export function zipVectors<T>(
  docs: readonly T[],
  vectors: readonly number[][],
): { readonly doc: T; readonly vector: number[] }[] {
  const pairs: { doc: T; vector: number[] }[] = []
  for (const [index, doc] of docs.entries()) {
    const vector = vectors[index]
    if (vector === undefined) break
    pairs.push({ doc, vector })
  }
  return pairs
}

/** Everything of one card that retrieval searches. */
function searchableText(card: CardDocument): string {
  return [
    card.title,
    card.concept,
    card.domainL1,
    card.domainL2,
    card.jurisdiction,
    card.lawRefs.join(' '),
    card.body,
  ].join('\n')
}

/** A stable content key: the path plus a digest of what was embedded. */
function contentKey(doc: CorpusDoc): string {
  const digest = createHash('sha256').update(doc.text).digest('hex').slice(0, 16)
  return `${doc.path}|${digest}`
}

/** Truncate text for a model call. */
function head(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit)
}

/** Whether another card in the library has replaced this one. */
function isDeprecated(doc: CorpusDoc): boolean {
  return doc.card.status === 'deprecated'
}

/**
 * Order candidates: live cards before deprecated ones, then by score, then by path.
 *
 * A deprecated card is text that another card replaced, so it must never answer
 * ahead of its replacement. Keeping it in the answer still serves a user who
 * remembers the old wording, which is why it sinks to the tail instead of being
 * hidden.
 * @param left - one candidate.
 * @param right - the other candidate.
 * @returns the comparison result.
 */
function byRank(
  left: { readonly doc: CorpusDoc; readonly score: number },
  right: { readonly doc: CorpusDoc; readonly score: number },
): number {
  return Number(isDeprecated(left.doc)) - Number(isDeprecated(right.doc))
    || right.score - left.score
    || left.doc.path.localeCompare(right.doc.path)
}

/**
 * Move candidates that repeat an earlier one behind the distinct ones.
 *
 * The order inside both parts survives, so this never reorders on its own: a card is
 * either where its score put it or behind the cards that already said the same thing.
 * A candidate the embedding server did not answer for stays where it is, because
 * nothing was measured about it.
 * @param entries - candidates in rank order.
 * @param pathOf - the library path of one candidate.
 * @param vectorOf - the candidate's embedding, or `undefined` when it has none.
 * @param threshold - the cosine at or above which a candidate counts as a repeat.
 * @returns the reordered candidates and how many were moved behind.
 */
export function suppressNearDuplicates<T>(
  entries: readonly T[],
  pathOf: (entry: T) => string,
  vectorOf: (path: string) => readonly number[] | undefined,
  threshold: number,
): { readonly ordered: readonly T[]; readonly moved: number } {
  const kept: T[] = []
  const keptVectors: (readonly number[])[] = []
  const repeated: T[] = []
  for (const entry of entries) {
    const vector = vectorOf(pathOf(entry))
    if (vector === undefined) {
      kept.push(entry)
      continue
    }
    if (keptVectors.some(other => cosine(vector, other) >= threshold)) {
      repeated.push(entry)
      continue
    }
    kept.push(entry)
    keptVectors.push(vector)
  }
  return { ordered: [...kept, ...repeated], moved: repeated.length }
}

/**
 * Build the retrieval service for one library.
 * @param deps - the library root, the resolved embedding plan, and the `fetch` implementation.
 * @returns the service.
 */
export function createSearchService(deps: {
  readonly libraryRoot: string
  readonly plan: EmbeddingPlan
  readonly fetchImpl: Fetcher
  readonly minScore: number | undefined
}): SearchService {
  const minScore = deps.minScore ?? DEFAULT_MIN_SCORE
  const vectors = new Map<string, number[]>()
  let resolved: { readonly embedder: Embedder } | { readonly reason: string } | undefined

  /** Resolve the key and the client once, and remember why it failed if it did. */
  async function embedderFor(): Promise<{ readonly embedder: Embedder } | { readonly reason: string }> {
    if (resolved !== undefined) return resolved
    if (!deps.plan.enabled) {
      resolved = { reason: deps.plan.reason }
      return resolved
    }
    const apiKey = await readApiKey(deps.plan.apiKeyFile)
    resolved = apiKey === undefined
      ? { reason: `未读到本地 API key：${deps.plan.apiKeyFile}` }
      : { embedder: createEmbedder(deps.plan, apiKey, deps.fetchImpl) }
    return resolved
  }

  /** The library as one snapshot, cards included. */
  async function corpus(): Promise<CorpusDoc[]> {
    const documents = await listCardDocuments(deps.libraryRoot)
    return documents.map(card => ({ path: card.path, text: searchableText(card), card }))
  }

  /**
   * Embed whatever is missing or changed.
   * @param embedder - the resolved client.
   * @param docs - the current corpus.
   * @returns the pairs that have a vector, and how many the server skipped.
   */
  async function embedCorpus(
    embedder: Embedder,
    docs: readonly CorpusDoc[],
  ): Promise<{ readonly pairs: { readonly doc: CorpusDoc; readonly vector: number[] }[]; readonly skipped: number }> {
    const wanted = new Set(docs.map(doc => contentKey(doc)))
    for (const key of [...vectors.keys()]) if (!wanted.has(key)) vectors.delete(key)
    const missing = docs.filter(doc => !vectors.has(contentKey(doc)))
    if (missing.length > 0) {
      const embedded = await embedder.embed(missing.map(doc => head(doc.text, EMBED_CHARS)))
      for (const { doc, vector } of zipVectors(missing, embedded)) vectors.set(contentKey(doc), vector)
    }
    const pairs: { doc: CorpusDoc; vector: number[] }[] = []
    for (const doc of docs) {
      const vector = vectors.get(contentKey(doc))
      if (vector !== undefined) pairs.push({ doc, vector })
    }
    return { pairs, skipped: docs.length - pairs.length }
  }

  return {
    async describe() {
      const state = await embedderFor()
      return {
        semantic: 'embedder' in state,
        reason: 'embedder' in state ? '' : state.reason,
        embedModel: deps.plan.enabled ? deps.plan.embedModel : '',
      }
    },
    async search(query, limit) {
      const trimmed = query.trim()
      const docs = await corpus()
      const deprecated = docs.filter(isDeprecated).length
      if (trimmed === '') {
        return { query: trimmed, mode: 'keyword', degraded: '', scanned: docs.length, deprecated, duplicates: 0, hits: [] }
      }
      const notes: string[] = []
      const keyword = searchIndex(buildIndex(docs), trimmed, CANDIDATES)
      const state = await embedderFor()
      let semantic: ScoredDoc<CorpusDoc>[] = []
      const vectorByPath = new Map<string, number[]>()
      if ('embedder' in state) {
        try {
          const embedded = await state.embedder.embed([trimmed])
          const queryVector = embedded[0]
          if (queryVector === undefined) throw new Error('嵌入服务没有返回查询向量')
          const { pairs, skipped } = await embedCorpus(state.embedder, docs)
          if (skipped > 0) notes.push(`嵌入服务只覆盖 ${String(pairs.length)}/${String(docs.length)} 张卡片`)
          for (const pair of pairs) vectorByPath.set(pair.doc.path, pair.vector)
          semantic = pairs
            .map(pair => ({ doc: pair.doc, score: cosine(queryVector, pair.vector) }))
            .filter(hit => hit.score >= minScore)
            .sort((left, right) => right.score - left.score || left.doc.path.localeCompare(right.doc.path))
            .slice(0, CANDIDATES)
        } catch (cause) {
          semantic = []
          notes.push(`嵌入调用失败，已退回关键词：${cause instanceof Error ? cause.message : String(cause)}`)
        }
      } else {
        notes.push(state.reason)
      }
      const bestKeyword = Math.max(...keyword.map(hit => hit.score), 1)
      const merged = new Map<string, Candidate>()
      const add = (doc: CorpusDoc, score: number, stage: SearchMode): void => {
        const current = merged.get(doc.path)
        if (current === undefined) {
          merged.set(doc.path, { doc, score, matched: [stage] })
          return
        }
        current.matched.push(stage)
        current.score = Math.max(current.score, score)
      }
      for (const hit of keyword) add(hit.doc, hit.score / bestKeyword, 'keyword')
      for (const hit of semantic) add(hit.doc, hit.score, 'vector')
      // Each stage's own best candidates keep a place in the pool, whatever the other
      // stage scored them; the rest of the pool fills by rank.
      const guaranteed = new Set<string>()
      for (const hit of keyword.slice(0, STAGE_SLOTS)) guaranteed.add(hit.doc.path)
      for (const hit of semantic.slice(0, STAGE_SLOTS)) guaranteed.add(hit.doc.path)
      let ordered = [...merged.values()]
        .sort((left, right) =>
          Number(guaranteed.has(right.doc.path)) - Number(guaranteed.has(left.doc.path))
          || byRank(left, right))
        .slice(0, CANDIDATES)
      let mode: SearchMode = semantic.length > 0 ? 'vector' : 'keyword'
      if (mode === 'vector' && deps.plan.enabled && deps.plan.rerank && 'embedder' in state) {
        try {
          const scored = await state.embedder.rerank(
            trimmed,
            ordered.map(entry => head(entry.doc.text, RERANK_CHARS)),
          )
          const byIndex = new Map(scored.map(entry => [entry.index, entry.score]))
          // A candidate the reranker did not answer for keeps the score the
          // recall stages gave it, so a partial answer degrades instead of losing it.
          ordered = ordered
            .map((entry, index) => ({ ...entry, score: byIndex.get(index) ?? entry.score }))
            .sort(byRank)
          mode = 'rerank'
        } catch (cause) {
          notes.push(`精排调用失败，已按语义排序：${cause instanceof Error ? cause.message : String(cause)}`)
        }
      }
      // A repeat is moved behind the distinct candidates, within its own live or retired
      // part, so neither this nor the deprecated rule can undo the other.
      const vectorOf = (path: string): readonly number[] | undefined => vectorByPath.get(path)
      const suppressed = suppressNearDuplicates(
        ordered.filter(entry => !isDeprecated(entry.doc)), entry => entry.doc.path, vectorOf, DUPLICATE_COSINE,
      )
      const suppressedRetired = suppressNearDuplicates(
        ordered.filter(entry => isDeprecated(entry.doc)), entry => entry.doc.path, vectorOf, DUPLICATE_COSINE,
      )
      ordered = [...suppressed.ordered, ...suppressedRetired.ordered]
      const duplicates = suppressed.moved + suppressedRetired.moved
      const hits: SearchHit[] = ordered.slice(0, limit).map(entry => ({
        path: entry.doc.path,
        title: entry.doc.card.title,
        type: entry.doc.card.type,
        domainL2: entry.doc.card.domainL2,
        concept: entry.doc.card.concept,
        lawRefs: entry.doc.card.lawRefs,
        sourcePath: entry.doc.card.sourcePath,
        status: entry.doc.card.status,
        score: entry.score,
        matched: entry.matched,
        snippet: snippet(entry.doc.text, trimmed, SNIPPET_CHARS),
      }))
      return { query: trimmed, mode, degraded: notes.join('；'), scanned: docs.length, deprecated, duplicates, hits }
    },
  }
}
