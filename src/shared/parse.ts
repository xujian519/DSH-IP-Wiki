/**
 * Parsing the library payloads at the wire boundary.
 *
 * The Client receives JSON, so it validates what it dereferences instead of
 * asserting a type onto it: every field the panel renders is read into a typed
 * value or replaced by a documented empty one, and a payload missing its
 * discriminant fails with a message naming the offending part rather than
 * rendering blank panes. The field names are this package's own Host route's, so
 * the parser reads the camelCase wire form and does not carry aliases.
 * @module dsh-ip-wiki/shared/parse
 */
import type { CardDraft, ConfirmResult, DraftKind, DraftView, RevertResult } from '../host/drafts'
import type { LintFinding, LintReport, LintTier } from '../host/lint'
import type {
  CardDocument,
  CardGroup,
  CardStatus,
  CardSummary,
  CardType,
  CardTypeBranch,
  DeleteResult,
  IndexBuild,
  IndexDrift,
  LibraryCounts,
  LibraryStatus,
  LibraryTree,
  ReportDocument,
  ReviewCard,
  SearchHit,
  SearchMode,
  SearchResult,
  SearchStatus,
} from './card'
import { asCardStatus, asCardType } from './card'
import type { DiffLine } from './diff'

/** Read one value as an object, or fail naming what was expected. */
function objectOf(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`dsh-ip-wiki: ${what} is not an object`)
  }
  return value as Record<string, unknown>
}

/** Read a value as text, or `undefined`. */
function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Read a value as text, falling back to `''`. */
function textOr(value: unknown): string {
  return textOf(value) ?? ''
}

/** Read a value as a number, or `undefined`. */
function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Read a value as an array, or `[]`. */
function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Read a value as a list of text items. */
function textsOf(value: unknown): string[] {
  return arrayOf(value).filter((item): item is string => typeof item === 'string')
}

/** Read a label-to-count map; counts are display-only, so a non-object reads as empty. */
function countsOf(value: unknown): Record<string, number> {
  const counts: Record<string, number> = {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return counts
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const count = numberOf(item)
    if (count !== undefined) counts[key] = count
  }
  return counts
}

/** Read the lifecycle status, defaulting to `draft` as the Host does. */
function statusOf(value: unknown): CardStatus {
  return asCardStatus(textOf(value))
}

/** Read the index-drift verdict. */
function driftOf(value: unknown): IndexDrift {
  switch (textOf(value) ?? '') {
    case 'none':
      return 'none'
    case 'missing':
      return 'missing'
    case 'count-mismatch':
      return 'count-mismatch'
    case 'unreadable':
      return 'unreadable'
    default:
      return 'unreadable'
  }
}

/** Read the card kind, failing when the payload names none the panel can render. */
function typeOf(value: unknown, path: string): CardType {
  const type = asCardType(textOf(value))
  if (type === undefined) throw new Error(`dsh-ip-wiki: card ${path} carries no known type`)
  return type
}

/**
 * Read one card summary.
 * @param value - the payload's summary object.
 * @returns the summary.
 * @throws {Error} when the object carries no known card kind.
 */
export function parseCardSummary(value: unknown): CardSummary {
  const item = objectOf(value, 'card')
  const path = textOr(item['path'])
  return {
    id: textOr(item['id']),
    type: typeOf(item['type'], path),
    title: textOr(item['title']),
    domainL1: textOr(item['domainL1']),
    domainL2: textOr(item['domainL2']),
    concept: textOr(item['concept']),
    status: statusOf(item['status']),
    confidence: numberOf(item['confidence']),
    quality: numberOf(item['quality']),
    path,
    relatedCount: numberOf(item['relatedCount']) ?? 0,
  }
}

/**
 * Read one review-queue entry.
 * @param value - the payload's entry object.
 * @returns the entry, which always carries the confidence that queued it.
 * @throws {Error} when the entry carries no known kind, or no confidence.
 */
export function parseReviewCard(value: unknown): ReviewCard {
  const summary = parseCardSummary(value)
  if (summary.confidence === undefined) {
    throw new Error(`dsh-ip-wiki: review entry ${summary.path} carries no confidence`)
  }
  return { ...summary, confidence: summary.confidence }
}

/** Read the status strip. */
export function parseStatus(value: unknown): LibraryStatus {
  const item = objectOf(value, 'status')
  return {
    root: textOr(item['root']),
    exists: item['exists'] === true,
    counts: parseCounts(item['counts']),
    indexGeneratedAt: textOf(item['indexGeneratedAt']),
    indexTotalCards: numberOf(item['indexTotalCards']),
    indexDrift: driftOf(item['indexDrift']),
    reports: textsOf(item['reports']),
    needsReview: arrayOf(item['needsReview']).map(parseReviewCard),
    problem: textOr(item['problem']),
  }
}

/** Read one tree group. */
function parseGroup(value: unknown, fallbackKey: string): CardGroup {
  const item = objectOf(value, 'group')
  return {
    key: textOr(item['key']) || fallbackKey,
    label: textOr(item['label']) || fallbackKey,
    cards: arrayOf(item['cards']).map(parseCardSummary),
  }
}

/** Read one card-kind branch. */
function parseBranch(value: unknown): CardTypeBranch {
  const item = objectOf(value, 'branch')
  const type = typeOf(item['type'], 'branch')
  const groups = arrayOf(item['groups'])
    .map((group, index) => parseGroup(group, `${type}#${String(index)}`))
  return {
    type,
    label: textOr(item['label']) || type,
    groups,
    total: numberOf(item['total']) ?? groups.reduce((sum, group) => sum + group.cards.length, 0),
  }
}

/** Read the counts block; counts are display-only, so an absent one reads as zeros. */
function parseCounts(value: unknown): LibraryCounts {
  const item = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    total: numberOf(item['total']) ?? 0,
    byType: countsOf(item['byType']),
    byDomain: countsOf(item['byDomain']),
    byStatus: countsOf(item['byStatus']),
  }
}

/**
 * Read the tree payload.
 * @param value - the parsed JSON body.
 * @returns the status strip and branches.
 * @throws {Error} when the payload is not an object or carries no status.
 */
export function parseLibraryTree(value: unknown): LibraryTree {
  const item = objectOf(value, 'tree')
  return {
    status: parseStatus(item['status']),
    branches: arrayOf(item['branches']).map(parseBranch),
  }
}

/**
 * Read the card payload.
 * @param value - the parsed JSON body.
 * @returns the card document.
 * @throws {Error} when the payload is not an object or carries no known card kind.
 */
export function parseCardDocumentPayload(value: unknown): CardDocument {
  const item = objectOf(value, 'card document')
  return {
    ...parseCardSummary(value),
    body: textOr(item['body']),
    lawRefs: textsOf(item['lawRefs']),
    relatedConcepts: textsOf(item['relatedConcepts']),
    jurisdiction: textOr(item['jurisdiction']),
    fromId: textOr(item['fromId']),
    supersededBy: textOr(item['supersededBy']),
    sourcePath: textOr(item['sourcePath']),
    needsReview: item['needsReview'] === true,
  }
}

/**
 * Read one search hit.
 * @param value - the payload's hit object.
 * @returns the hit.
 * @throws {Error} when the hit carries no known card kind.
 */
export function parseSearchHit(value: unknown): SearchHit {
  const item = objectOf(value, 'search hit')
  const path = textOr(item['path'])
  return {
    path,
    title: textOr(item['title']),
    type: typeOf(item['type'], path),
    domainL2: textOr(item['domainL2']),
    concept: textOr(item['concept']),
    lawRefs: textsOf(item['lawRefs']),
    sourcePath: textOr(item['sourcePath']),
    status: statusOf(item['status']),
    score: numberOf(item['score']) ?? 0,
    matched: arrayOf(item['matched']).filter(isSearchMode),
    snippet: textOr(item['snippet']),
  }
}

/** Read one value as a retrieval stage name. */
function isSearchMode(value: unknown): value is SearchMode {
  return value === 'keyword' || value === 'vector' || value === 'rerank'
}

/**
 * Read the search payload.
 * @param value - the parsed JSON body.
 * @returns the hits and the stage that ordered them.
 * @throws {Error} when the payload is not an object or names no known stage.
 */
export function parseSearchResult(value: unknown): SearchResult {
  const item = objectOf(value, 'search result')
  const stage = textOf(item['mode'])
  if (stage !== 'keyword' && stage !== 'vector' && stage !== 'rerank') {
    throw new Error(`dsh-ip-wiki: search result names no known stage: ${String(stage)}`)
  }
  return {
    query: textOr(item['query']),
    mode: stage,
    degraded: textOr(item['degraded']),
    scanned: numberOf(item['scanned']) ?? 0,
    deprecated: numberOf(item['deprecated']) ?? 0,
    duplicates: numberOf(item['duplicates']) ?? 0,
    hits: arrayOf(item['hits']).map(parseSearchHit),
  }
}

/**
 * Read the retrieval-status payload.
 * @param value - the parsed JSON body.
 * @returns the availability and its reason.
 * @throws {Error} when the payload is not an object.
 */
export function parseSearchStatus(value: unknown): SearchStatus {
  const item = objectOf(value, 'search status')
  return {
    semantic: item['semantic'] === true,
    reason: textOr(item['reason']),
    embedModel: textOr(item['embedModel']),
  }
}

/** Read one draft kind off the wire, defaulting to a plain card draft. */
function draftKindOf(value: string | undefined): DraftKind {
  return value === 'merge' || value === 'status' ? value : 'card'
}

/** Read one stored draft. */
export function parseCardDraft(value: unknown): CardDraft {
  const item = objectOf(value, 'draft')
  const status = textOf(item['status'])
  return {
    id: textOr(item['id']),
    kind: draftKindOf(textOf(item['kind'])),
    target: textOr(item['target']),
    type: typeOf(item['type'], textOr(item['target'])),
    title: textOr(item['title']),
    content: textOr(item['content']),
    supersedes: textsOf(item['supersedes']),
    classification: textOf(item['classification']) === 'client-material' ? 'client-material' : 'public',
    generatedBy: textOf(item['generatedBy']) === 'dsh-model'
      ? 'dsh-model'
      : textOf(item['generatedBy']) === 'local-model' ? 'local-model' : 'human',
    policy: textOf(item['policy']) === 'local-only' ? 'local-only' : 'dsh-model-allowed',
    sourceRef: textOr(item['sourceRef']),
    note: textOr(item['note']),
    createdAt: textOr(item['createdAt']),
    status: status === 'confirmed' || status === 'discarded' ? status : 'pending',
    confirmedAt: textOf(item['confirmedAt']),
    revertedAt: textOf(item['revertedAt']),
  }
}

/** Read one difference line. */
function parseDiffLine(value: unknown): DiffLine {
  const item = objectOf(value, 'diff line')
  const kind = textOf(item['kind'])
  return {
    kind: kind === 'added' || kind === 'removed' ? kind : 'same',
    text: textOr(item['text']),
  }
}

/**
 * Read one draft with its difference.
 * @param value - the parsed JSON body.
 * @returns the view.
 * @throws {Error} when the payload is not an object.
 */
export function parseDraftView(value: unknown): DraftView {
  const item = objectOf(value, 'draft view')
  // Counts are display-only, so an absent block reads as zeros, as the tree's does.
  const counts = typeof item['counts'] === 'object' && item['counts'] !== null && !Array.isArray(item['counts'])
    ? item['counts'] as Record<string, unknown>
    : {}
  return {
    draft: parseCardDraft(item['draft']),
    diff: arrayOf(item['diff']).map(parseDiffLine),
    counts: { added: numberOf(counts['added']) ?? 0, removed: numberOf(counts['removed']) ?? 0 },
    existing: item['existing'] === true,
  }
}

/**
 * Read the pending-drafts payload.
 * @param value - the parsed JSON body.
 * @returns the drafts.
 * @throws {Error} when the payload is not an object.
 */
export function parseDraftList(value: unknown): CardDraft[] {
  return arrayOf(objectOf(value, 'drafts')['drafts']).map(parseCardDraft)
}

/**
 * Read the confirm payload.
 * @param value - the parsed JSON body.
 * @returns where the card landed and what the write did.
 * @throws {Error} when the payload is not an object.
 */
export function parseConfirmResult(value: unknown): ConfirmResult {
  const item = objectOf(value, 'confirm')
  const action = textOf(item['action'])
  return {
    path: textOr(item['path']),
    action: action === 'replaced' ? 'replaced' : 'created',
    backup: textOf(item['backup']),
    deprecated: textsOf(item['deprecated']),
  }
}

/**
 * Read the revert payload.
 * @param value - the parsed JSON body.
 * @returns the card the revert touched and what it did.
 * @throws {Error} when the payload is not an object.
 */
export function parseRevertResult(value: unknown): RevertResult {
  const item = objectOf(value, 'revert')
  const action = textOf(item['action'])
  return {
    path: textOr(item['path']),
    action: action === 'restored' ? 'restored' : 'deleted',
    restored: textsOf(item['restored']),
  }
}

/**
 * Read the delete payload.
 * @param value - the parsed JSON body.
 * @returns the card that went, the cards that lost a reference, and the new count.
 * @throws {Error} when the payload is not an object or names no card.
 */
export function parseDeleteResult(value: unknown): DeleteResult {
  const item = objectOf(value, 'delete')
  const path = textOf(item['path'])
  if (path === undefined || path === '') throw new Error('delete payload carries no path')
  return {
    path,
    title: textOr(item['title']),
    stripped: textsOf(item['stripped']),
    totalCards: numberOf(item['totalCards']) ?? 0,
  }
}

/** Read one tier name, defaulting to the least serious. */
function tierOf(value: unknown): LintTier {
  switch (textOf(value) ?? '') {
    case 'critical':
      return 'critical'
    case 'warning':
      return 'warning'
    default:
      return 'suggestion'
  }
}

/**
 * Read the result of an index rebuild.
 * @param value - the parsed JSON body.
 * @returns the counts the panel needs.
 * @throws {Error} when the payload is not an object.
 */
export function parseIndexBuild(value: unknown): IndexBuild {
  const item = objectOf(value, 'index build')
  return {
    totalCards: numberOf(item['totalCards']) ?? 0,
    byType: countsOf(item['byType']),
    byDomain: countsOf(item['byDomain']),
    backup: textOr(item['backup']),
  }
}

/**
 * Read the quality-gate report.
 * @param value - the parsed JSON body.
 * @returns the report.
 * @throws {Error} when the payload is not an object.
 */
export function parseLintReport(value: unknown): LintReport {
  const item = objectOf(value, 'lint report')
  const counts = typeof item['counts'] === 'object' && item['counts'] !== null && !Array.isArray(item['counts'])
    ? item['counts'] as Record<string, unknown>
    : {}
  const findings: LintFinding[] = arrayOf(item['findings']).map((entry) => {
    const finding = objectOf(entry, 'lint finding')
    return {
      tier: tierOf(finding['tier']),
      code: textOr(finding['code']),
      message: textOr(finding['message']),
      path: textOr(finding['path']),
    }
  })
  return {
    scanned: numberOf(item['scanned']) ?? 0,
    findings,
    counts: {
      critical: numberOf(counts['critical']) ?? 0,
      warning: numberOf(counts['warning']) ?? 0,
      suggestion: numberOf(counts['suggestion']) ?? 0,
    },
    failOn: tierOf(item['failOn']),
    verdict: textOf(item['verdict']) === 'fail' ? 'fail' : 'pass',
  }
}

/**
 * Read the report payload.
 * @param value - the parsed JSON body.
 * @returns the report.
 * @throws {Error} when the payload is not an object.
 */
export function parseReportDocument(value: unknown): ReportDocument {
  const item = objectOf(value, 'report')
  return { name: textOr(item['name']), text: textOr(item['text']) }
}

/**
 * Read the reports-list payload.
 * @param value - the parsed JSON body.
 * @returns the file names.
 * @throws {Error} when the payload is not an object.
 */
export function parseReportList(value: unknown): string[] {
  return textsOf(objectOf(value, 'reports')['reports'])
}
