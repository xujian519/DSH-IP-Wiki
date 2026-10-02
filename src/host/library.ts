/**
 * Reading the card library on disk.
 *
 * The reader is the library's only truth for the panel: it scans `cards/` rather
 * than trusting `index/card-index.json`, and reports the index only as a
 * cross-check, because the index is a derived artifact that a stale build can
 * leave disagreeing with the files. Every path below the library root is
 * resolved through {@link resolveInside}, so a request cannot address a file
 * outside the root even if the caller sends an absolute path or `..`.
 * @module dsh-ip-wiki/host/library
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  CardDocument,
  CardGroup,
  CardStatus,
  CardSummary,
  CardTypeBranch,
  IndexDrift,
  LibraryCounts,
  LibraryStatus,
  LibraryTree,
  ReportDocument,
  ReviewCard,
} from '../shared/card'
import { CARD_TYPES, CARD_TYPE_LABEL, asCardStatus, asCardType } from '../shared/card'
import { isMap, numberField, parseFrontmatter, textField, textList, type Frontmatter } from '../shared/frontmatter'

/** Directory under the library root that holds cards, per kind. */
const CARDS_DIR = 'cards'

/** Directory under the library root that holds reports. */
const REPORTS_DIR = 'reports'

/** Derived index the reader cross-checks but never trusts. */
export const INDEX_FILE = 'index/card-index.json'

/**
 * Resolve a library-relative path and refuse anything that leaves the root.
 * @param root - absolute library root.
 * @param relativePath - caller-supplied path, with `/` or host separators.
 * @returns the absolute path, or `undefined` when it escapes the root or is empty.
 */
export function resolveInside(root: string, relativePath: string): string | undefined {
  const trimmed = relativePath.trim()
  if (trimmed === '') return undefined
  const base = resolve(root)
  const target = resolve(base, trimmed)
  if (target !== base && !target.startsWith(base + sep)) return undefined
  return target
}

/**
 * Normalize a path for the wire: separators to `/`, relative to the root.
 * @param root - absolute library root.
 * @param absolute - path inside the root.
 * @returns the relative path.
 */
export function relativeTo(root: string, absolute: string): string {
  return relative(resolve(root), absolute).split(sep).join('/')
}

/**
 * Join the library's own directory and file names onto the root.
 *
 * These are constants this module never takes from a caller, so joining them
 * cannot leave the root and needs no containment check; caller-supplied paths go
 * through {@link resolveInside} instead.
 * @param root - absolute library root.
 * @param segments - constant names below the root.
 * @returns the absolute path.
 */
export function inside(root: string, ...segments: readonly string[]): string {
  return join(resolve(root), ...segments)
}

/** Read one frontmatter field as a non-empty string, or a documented fallback. */
function field(fields: Frontmatter, key: string, fallback: string): string {
  const value = textField(fields, key)
  return value === undefined || value === '' ? fallback : value
}

/** Narrow the `status` field, defaulting to `draft` because that is what an unlabelled card is. */
function statusOf(fields: Frontmatter): CardStatus {
  return asCardStatus(textField(fields, 'status'))
}

/** Build a summary from one parsed card. */
function toSummary(
  fields: Frontmatter,
  path: string,
  fallbackTitle: string,
): CardSummary | undefined {
  const type = asCardType(textField(fields, 'type'))
  if (type === undefined) return undefined
  const id = textField(fields, 'id') ?? path
  return {
    id,
    type,
    title: field(fields, 'title', fallbackTitle),
    domainL1: field(fields, 'domain_l1', '未分类'),
    domainL2: field(fields, 'domain_l2', '未分类'),
    concept: field(fields, 'concept', ''),
    status: statusOf(fields),
    confidence: numberField(fields, 'confidence'),
    quality: numberField(fields, 'quality'),
    path,
    relatedCount: textList(fields, 'related_concepts').length,
  }
}

/** First Markdown heading in a body, used when the frontmatter carries no title. */
function headingOf(body: string): string {
  for (const line of body.split('\n')) {
    if (line.startsWith('# ')) return line.slice(2).trim()
  }
  return ''
}

/** Read every `.md` file under a directory, one level of recursion. */
async function markdownFiles(dir: string): Promise<string[]> {
  const found: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    // A missing kind directory is an empty kind, not an error: the library is
    // created incrementally, so carves out no card of that kind yet.
    return found
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...await markdownFiles(full))
      continue
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) found.push(full)
  }
  return found
}

/**
 * Parse one card file's text into a document.
 * @param text - the file's text.
 * @param path - the card's library-relative path.
 * @returns the parsed document, or `undefined` when the file declares no card kind.
 */
function documentFrom(text: string, path: string): CardDocument | undefined {
  const { fields, body } = parseFrontmatter(text)
  const summary = toSummary(fields, path, headingOf(body))
  if (summary === undefined) return undefined
  const source = fields['source']
  const sourcePath = isMap(source) && typeof source['path'] === 'string' ? source['path'] : ''
  const migration = fields['migration']
  const fromId = isMap(migration) && typeof migration['from_id'] === 'string' ? migration['from_id'] : ''
  return {
    ...summary,
    body,
    fromId,
    supersededBy: field(fields, 'superseded_by', ''),
    lawRefs: textList(fields, 'law_refs'),
    relatedConcepts: textList(fields, 'related_concepts'),
    jurisdiction: field(fields, 'jurisdiction', ''),
    sourcePath,
    needsReview: fields['needs_review'] === true,
  }
}

/**
 * The summary fields of one document, without its body.
 * @param document - a parsed document.
 * @returns the summary the tree and counts use.
 */
function summaryOf(document: CardDocument): CardSummary {
  return {
    id: document.id,
    type: document.type,
    title: document.title,
    domainL1: document.domainL1,
    domainL2: document.domainL2,
    concept: document.concept,
    status: document.status,
    confidence: document.confidence,
    quality: document.quality,
    path: document.path,
    relatedCount: document.relatedCount,
  }
}

/**
 * Every card under the root with its body, read in one traversal.
 *
 * The tree, the counts, and retrieval all come from this one pass, so a card
 * cannot be counted and then be missing when its body is wanted.
 * @param root - absolute library root.
 * @returns the documents, path-ordered.
 */
export async function listCardDocuments(root: string): Promise<CardDocument[]> {
  const cardsDir = inside(root, CARDS_DIR)
  const documents: CardDocument[] = []
  for (const file of (await markdownFiles(cardsDir)).sort()) {
    const document = documentFrom(await readFile(file, 'utf8'), relativeTo(root, file))
    if (document !== undefined) documents.push(document)
  }
  return documents
}

/** Count values of one derived key. */
function tally(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

/** Order a count map by descending count, then by label. */
function byCountDescending(counts: Record<string, number>): Record<string, number> {
  const ordered: Record<string, number> = {}
  for (const [key, count] of Object.entries(counts).sort((left, right) =>
    right[1] - left[1] || left[0].localeCompare(right[0], 'zh-Hans-CN'))) {
    ordered[key] = count
  }
  return ordered
}

/** Counts over a card list. */
export function countsOf(cards: readonly CardSummary[]): LibraryCounts {
  return {
    total: cards.length,
    byType: byCountDescending(tally(cards.map(card => card.type))),
    byDomain: byCountDescending(tally(cards.map(card => card.domainL2))),
    byStatus: byCountDescending(tally(cards.map(card => card.status))),
  }
}

/** Compare the derived index against the cards actually read. */
function driftOf(
  indexTotal: number | undefined,
  indexReadable: boolean,
  actualTotal: number,
): IndexDrift {
  if (!indexReadable) return 'unreadable'
  if (indexTotal === undefined) return 'missing'
  return indexTotal === actualTotal ? 'none' : 'count-mismatch'
}

/** Read `index/card-index.json` for its generation facts only. */
export async function readIndexSummary(root: string): Promise<{
  generatedAt: string | undefined
  totalCards: number | undefined
  readable: boolean
}> {
  const path = inside(root, INDEX_FILE)
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) {
      return { generatedAt: undefined, totalCards: undefined, readable: false }
    }
    const record: Record<string, unknown> = { ...parsed }
    const generatedAt = record['generated_at']
    const totalCards = record['total_cards']
    return {
      generatedAt: typeof generatedAt === 'string' ? generatedAt : undefined,
      totalCards: typeof totalCards === 'number' ? totalCards : undefined,
      readable: true,
    }
  } catch {
    // The index is derived: unreadable means "rebuild it", which the status strip
    // reports, and never a reason to fail the panel.
    return { generatedAt: undefined, totalCards: undefined, readable: false }
  }
}

/** Every card under the root, title-ordered. */
export async function listCards(root: string): Promise<CardSummary[]> {
  return (await listCardDocuments(root)).map(summaryOf)
}

/**
 * Read one card by its library-relative path.
 * @param root - absolute library root.
 * @param path - the card's path as the tree reported it.
 * @returns the document, or `undefined` when the path escapes the root, the file
 * is missing, or it carries no known card kind.
 */
export async function readCard(root: string, path: string): Promise<CardDocument | undefined> {
  const absolute = resolveInside(root, path)
  if (absolute === undefined) return undefined
  const info = await stat(absolute).catch(() => undefined)
  if (info === undefined || !info.isFile()) return undefined
  return documentFrom(await readFile(absolute, 'utf8'), relativeTo(root, absolute))
}

/** Report file names under `reports/`, sorted. */
export async function listReports(root: string): Promise<string[]> {
  const dir = inside(root, REPORTS_DIR)
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map(entry => entry.name)
    .sort()
}

/**
 * Read one report by file name.
 * @param root - absolute library root.
 * @param name - the report's file name, as the list reported it.
 * @returns the report, or `undefined` when the name escapes `reports/`.
 */
export async function readReport(root: string, name: string): Promise<ReportDocument | undefined> {
  const dir = inside(root, REPORTS_DIR)
  const absolute = resolveInside(dir, name)
  if (absolute === undefined) return undefined
  const info = await stat(absolute).catch(() => undefined)
  if (info === undefined || !info.isFile()) return undefined
  const text = await readFile(absolute, 'utf8')
  return { name, text }
}

/**
 * Group cards into the panel's branches: one per card kind, grouped by domain.
 * @param cards - every card under the root.
 * @returns branches in {@link CARD_TYPES} order, skipping empty kinds.
 */
export function branchCards(cards: readonly CardSummary[]): CardTypeBranch[] {
  const branches: CardTypeBranch[] = []
  for (const type of CARD_TYPES) {
    const ofType = cards.filter(card => card.type === type)
    if (ofType.length === 0) continue
    const groups = new Map<string, CardSummary[]>()
    for (const card of ofType) {
      const key = card.domainL2
      const bucket = groups.get(key)
      if (bucket === undefined) groups.set(key, [card])
      else bucket.push(card)
    }
    const ordered: CardGroup[] = [...groups.entries()]
      .sort((left, right) =>
        right[1].length - left[1].length || left[0].localeCompare(right[0], 'zh-Hans-CN'))
      .map(([label, group]) => ({
        key: `${type}/${label}`,
        label,
        cards: [...group].sort((left, right) =>
          left.title.localeCompare(right.title, 'zh-Hans-CN')),
      }))
    branches.push({ type, label: CARD_TYPE_LABEL[type], groups: ordered, total: ofType.length })
  }
  return branches
}

/**
 * Read the library's status strip.
 * @param root - absolute library root.
 * @returns counts, index drift, report names, and the review queue.
 */
export async function readStatus(root: string): Promise<LibraryStatus> {
  const info = await stat(root).catch(() => undefined)
  const exists = info !== undefined && info.isDirectory()
  if (!exists) {
    const missing = info === undefined ? '库根不存在' : '库根不是目录'
    return {
      root,
      exists: false,
      counts: { total: 0, byType: {}, byDomain: {}, byStatus: {} },
      indexGeneratedAt: undefined,
      indexTotalCards: undefined,
      indexDrift: 'unreadable',
      reports: [],
      needsReview: [],
      problem: `${missing}：${root}`,
    }
  }
  const cards = await listCards(root)
  const index = await readIndexSummary(root)
  // The review queue is the low-confidence set, most doubtful first; the type
  // predicate carries the confidence the comparator orders by.
  const review = cards
    .filter((card): card is ReviewCard =>
      card.confidence !== undefined && card.confidence < 0.8)
    .sort((left, right) =>
      left.confidence - right.confidence
      || left.title.localeCompare(right.title, 'zh-Hans-CN'))
  return {
    root,
    exists: true,
    counts: countsOf(cards),
    indexGeneratedAt: index.generatedAt,
    indexTotalCards: index.totalCards,
    indexDrift: driftOf(index.totalCards, index.readable, cards.length),
    reports: await listReports(root),
    needsReview: review,
    problem: '',
  }
}

/**
 * Read everything the panel needs for its first paint.
 * @param root - absolute library root.
 * @returns the status strip and the card tree.
 */
export async function readTree(root: string): Promise<LibraryTree> {
  const status = await readStatus(root)
  const branches = status.exists ? branchCards(await listCards(root)) : []
  return { status, branches }
}

/**
 * Whether a path is absolute, for the Host's configuration check.
 * @param path - candidate library root.
 * @returns true when the path is absolute.
 */
export function isAbsoluteRoot(path: string): boolean {
  return isAbsolute(path)
}
