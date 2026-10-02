/**
 * Keyword retrieval over card text.
 *
 * The library is small enough to score in memory, so the lexical side is a plain
 * BM25 pass built per request rather than a persisted full-text store: nothing has
 * to be rebuilt when a card changes, and the plugin writes no derived file. Text is
 * tokenized into Latin words and CJK characters plus character bigrams, which is
 * what makes a Chinese query match Chinese cards without a segmenter.
 * @module dsh-ip-wiki/host/retrieval
 */

/** BM25 term-frequency saturation. */
const K1 = 1.2

/** BM25 length normalization. */
const B = 0.75

/** Whether one character is CJK (including the compatibility and extension-A blocks). */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u

/** Whether one character is part of a Latin or numeric word. */
const WORD = /[a-z0-9]/u

/**
 * Tokenize text for matching.
 * @param text - any text, normalized inside.
 * @returns Latin words whole, and CJK characters both singly and as adjacent pairs.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  let latin = ''
  let run: string[] = []
  const flushLatin = (): void => {
    if (latin === '') return
    tokens.push(latin)
    latin = ''
  }
  const flushRun = (): void => {
    // Each character and each adjacent pair: the pair carries the word, and the
    // single character is what a one-character query can still match.
    for (const [index, character] of run.entries()) {
      tokens.push(character)
      const next = run[index + 1]
      if (next !== undefined) tokens.push(`${character}${next}`)
    }
    run = []
  }
  for (const character of text.normalize('NFKC').toLowerCase()) {
    if (CJK.test(character)) {
      flushLatin()
      run.push(character)
      continue
    }
    if (WORD.test(character)) {
      flushRun()
      latin += character
      continue
    }
    flushLatin()
    flushRun()
  }
  flushLatin()
  flushRun()
  return tokens
}

/** One document in the keyword index. */
export interface RetrievalDoc {
  /** Stable identity the hits carry back. */
  readonly path: string
  /** Every text the document is searched by. */
  readonly text: string
}

/** The in-memory keyword index over one snapshot of the corpus. */
export interface RetrievalIndex<T extends RetrievalDoc> {
  /** Indexed documents with their term counts and length. */
  readonly docs: readonly {
    readonly doc: T
    readonly counts: ReadonlyMap<string, number>
    readonly length: number
  }[]
  /** Document frequency per term. */
  readonly df: Readonly<Record<string, number>>
  /** Mean document length in tokens, never zero. */
  readonly averageLength: number
}

/** One scored document. */
export interface ScoredDoc<T extends RetrievalDoc> {
  /** The document that matched. */
  readonly doc: T
  /** BM25 score, higher first. */
  readonly score: number
}

/**
 * Build the keyword index.
 * @param docs - the documents to index.
 * @returns the index.
 */
export function buildIndex<T extends RetrievalDoc>(docs: readonly T[]): RetrievalIndex<T> {
  const indexed: RetrievalIndex<T>['docs'] = docs.map((doc) => {
    const counts = new Map<string, number>()
    const tokens = tokenize(doc.text)
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
    return { doc, counts, length: tokens.length }
  })
  const df: Record<string, number> = {}
  for (const entry of indexed) for (const term of entry.counts.keys()) df[term] = (df[term] ?? 0) + 1
  const total = indexed.reduce((sum, entry) => sum + entry.length, 0)
  const mean = indexed.length === 0 ? 0 : total / indexed.length
  return { docs: indexed, df, averageLength: Math.max(1, mean) }
}

/**
 * Score every document against a query.
 *
 * A document indexes single CJK characters as well as pairs, so a one-character
 * query still works; but a single character is a weak signal that any long query
 * shares by accident, so the pairs and Latin words score first and the single
 * characters are consulted only when nothing stronger matched anything.
 * @param index - the keyword index.
 * @param query - the query text.
 * @param limit - the greatest number of hits to return.
 * @returns the hits, best first; an empty query, or no match, yields no hits.
 */
export function searchIndex<T extends RetrievalDoc>(
  index: RetrievalIndex<T>,
  query: string,
  limit: number,
): ScoredDoc<T>[] {
  const terms = [...new Set(tokenize(query))]
  if (terms.length === 0) return []
  const strong = scoreDocs(index, terms.filter(isStrongTerm), limit)
  if (strong.length > 0) return strong
  return scoreDocs(index, terms.filter(term => !isStrongTerm(term)), limit)
}

/** Whether a term carries more than a single CJK character's worth of evidence. */
function isStrongTerm(term: string): boolean {
  return term.length > 1 || !CJK.test(term)
}

/** Rank documents by BM25 over one term set. */
function scoreDocs<T extends RetrievalDoc>(
  index: RetrievalIndex<T>,
  terms: readonly string[],
  limit: number,
): ScoredDoc<T>[] {
  const scored: ScoredDoc<T>[] = []
  for (const entry of index.docs) {
    let score = 0
    for (const term of terms) {
      const tf = entry.counts.get(term) ?? 0
      const df = index.df[term] ?? 0
      if (tf === 0) continue
      const idf = Math.log(1 + (index.docs.length - df + 0.5) / (df + 0.5))
      score += idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * entry.length / index.averageLength))
    }
    if (score > 0) scored.push({ doc: entry.doc, score })
  }
  return scored
    .sort((left, right) => right.score - left.score || left.doc.path.localeCompare(right.doc.path))
    .slice(0, limit)
}

/**
 * The most query-like excerpt of one document.
 * @param text - the document's searchable text.
 * @param query - the query text.
 * @param width - the greatest number of characters to keep.
 * @returns the best matching line, truncated, or the first line when nothing matches.
 */
export function snippet(text: string, query: string, width: number): string {
  const terms = tokenize(query)
  const lines = text.split('\n').map(line => line.trim()).filter(line => line !== '')
  let best = ''
  let bestScore = 0
  for (const line of lines) {
    let score = 0
    for (const term of terms) {
      if (line.includes(term)) score += 1
    }
    if (score > bestScore) {
      bestScore = score
      best = line
    }
  }
  const chosen = bestScore > 0 ? best : (lines[0] ?? '')
  return chosen.length > width ? `${chosen.slice(0, width)}…` : chosen
}
