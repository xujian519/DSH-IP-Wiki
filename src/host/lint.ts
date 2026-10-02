/**
 * The library's quality gate: deterministic checks over the cards on disk.
 *
 * Every finding is produced by a rule that reads only card facts, so the same
 * library always yields the same report and a finding can be argued with. Findings
 * are tiered — `critical` (the card is unusable), `warning` (the library is
 * inconsistent), `suggestion` (worth a human's attention) — and the report carries
 * a verdict against the tier the caller is willing to fail on.
 * @module dsh-ip-wiki/host/lint
 */
import type { CardDocument } from '../shared/card'
import { listCardDocuments, readIndexSummary } from './library'

/** How serious a finding is. */
export type LintTier = 'critical' | 'warning' | 'suggestion'

/** The tiers, least to most serious, which is also the order a report reads. */
export const TIERS: readonly LintTier[] = ['critical', 'warning', 'suggestion']

/** One rule's verdict on one card, or on the library as a whole. */
export interface LintFinding {
  /** How serious the finding is. */
  readonly tier: LintTier
  /** Stable rule name, so a report can be diffed between runs. */
  readonly code: string
  /** What is wrong, in the reader's language. */
  readonly message: string
  /** The card the finding is about, or empty text for a library-wide finding. */
  readonly path: string
}

/** Everything the gate reports for one library. */
export interface LintReport {
  /** How many cards the gate read. */
  readonly scanned: number
  /** Findings, most serious tier first. */
  readonly findings: readonly LintFinding[]
  /** How many findings of each tier. */
  readonly counts: Readonly<Record<LintTier, number>>
  /** The tier the caller asked to fail on. */
  readonly failOn: LintTier
  /** `fail` when a finding at or above `failOn` exists. */
  readonly verdict: 'pass' | 'fail'
}

/** What the gate needs beyond the cards. */
export interface LintFacts {
  /** `total_cards` the derived index claims, or `undefined` when it is unreadable. */
  readonly indexTotalCards: number | undefined
}

/** Confidence below which the migration already queued a card for review. */
const REVIEW_BELOW = 0.8

/** One set of cards whose titles are the same once punctuation and case are gone. */
export interface DuplicateGroup {
  /** The first card's title, as a label for the group. */
  readonly title: string
  /** The cards in the group, path-ordered. */
  readonly paths: readonly string[]
}

/**
 * Group the cards that share a title.
 *
 * Callers pass the live cards: a superseded card keeps its title on purpose, and a
 * merge must be able to clear the finding it resolved.
 * @param documents - the cards to compare.
 * @returns the groups with more than one card, biggest first; untitled cards are
 * left to the `missing-title` rule rather than grouped as duplicates of each other.
 */
export function duplicateGroups(documents: readonly CardDocument[]): DuplicateGroup[] {
  const groups = new Map<string, { title: string; paths: string[] }>()
  for (const document of documents) {
    const key = normalizeTitle(document.title)
    const group = groups.get(key)
    if (group === undefined) groups.set(key, { title: document.title, paths: [document.path] })
    else group.paths.push(document.path)
  }
  return [...groups.values()]
    .filter(group => group.paths.length > 1 && group.title !== '')
    .sort((left, right) =>
      right.paths.length - left.paths.length || left.title.localeCompare(right.title))
}

/**
 * Strip everything that carries no identity, so two spellings of one title meet.
 *
 * Punctuation, case, and the particle 的 are dropped: "…否定权利要求创造性？" and
 * "…否定权利要求的创造性？" are one question asked twice. The rule only proposes a
 * merge candidate; a human confirms it, so a slightly eager comparison is right.
 * @param title - the card title.
 * @returns the comparison key.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/的/gu, '')
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, '')
}

/** Whether a finding at a tier fails a gate that fails on another tier. */
function atOrAbove(tier: LintTier, failOn: LintTier): boolean {
  return TIERS.indexOf(tier) <= TIERS.indexOf(failOn)
}

/**
 * Run every rule over one snapshot of the library.
 * @param documents - the cards, as the reader produced them.
 * @param facts - what the derived index claims.
 * @param failOn - the tier the caller is willing to fail on.
 * @returns the report.
 */
export function lintCards(
  documents: readonly CardDocument[],
  facts: LintFacts,
  failOn: LintTier,
): LintReport {
  const findings: LintFinding[] = []
  const live = documents.filter(document => document.status !== 'deprecated')
  const byId = new Map<string, CardDocument>()
  for (const document of documents) {
    byId.set(document.id, document)
    if (document.fromId !== '') byId.set(document.fromId, document)
  }
  const referenced = new Set<string>()
  for (const document of documents) {
    for (const related of document.relatedConcepts) {
      const target = byId.get(related)
      if (target === undefined) {
        findings.push({
          tier: 'warning',
          code: 'broken-link',
          message: `关联卡片指向不存在的卡：${related}`,
          path: document.path,
        })
        continue
      }
      referenced.add(target.path)
    }
  }
  for (const document of documents) {
    if (document.title === '') {
      findings.push({ tier: 'critical', code: 'missing-title', message: '卡片没有标题', path: document.path })
    }
    if (document.body.trim() === '') {
      findings.push({ tier: 'critical', code: 'empty-body', message: '卡片正文为空', path: document.path })
    }
    if (document.domainL2 === '' || document.domainL2 === '未分类') {
      findings.push({ tier: 'suggestion', code: 'unclassified', message: '未归入业务域（domain_l2）', path: document.path })
    }
    if (document.concept === '') {
      findings.push({ tier: 'suggestion', code: 'missing-concept', message: '没有概念标签（concept）', path: document.path })
    }
    if (document.confidence !== undefined && document.confidence < REVIEW_BELOW) {
      findings.push({
        tier: 'suggestion',
        code: 'low-confidence',
        message: `置信度 ${document.confidence.toFixed(2)} 低于 ${String(REVIEW_BELOW)}，待人工确认`,
        path: document.path,
      })
    }
    if (document.status !== 'deprecated' && document.relatedConcepts.length === 0 && !referenced.has(document.path)) {
      findings.push({ tier: 'suggestion', code: 'orphan-card', message: '孤立卡片：既没有关联卡片，也没有被任何卡片关联', path: document.path })
    }
  }
  // Duplicates and orphans are about the library as it stands: a card that was
  // superseded by a merge is history, and flagging it forever would make the gate
  // noise that never clears.
  for (const group of duplicateGroups(live)) {
    for (const path of group.paths) {
      findings.push({
        tier: 'warning',
        code: 'duplicate-title',
        message: `标题重复（${String(group.paths.length)} 张）：${path}`,
        path,
      })
    }
  }
  if (facts.indexTotalCards === undefined) {
    findings.push({ tier: 'warning', code: 'index-missing', message: '索引不可读或缺少计数，需要重建', path: '' })
  } else if (facts.indexTotalCards !== documents.length) {
    findings.push({
      tier: 'warning',
      code: 'index-drift',
      message: `索引计数与磁盘不一致：索引 ${String(facts.indexTotalCards)} / 磁盘 ${String(documents.length)}`,
      path: '',
    })
  }
  const counts: Record<LintTier, number> = { critical: 0, warning: 0, suggestion: 0 }
  for (const finding of findings) counts[finding.tier] += 1
  const ordered = [...findings].sort((left, right) =>
    TIERS.indexOf(left.tier) - TIERS.indexOf(right.tier)
    || left.code.localeCompare(right.code)
    || left.path.localeCompare(right.path))
  return {
    scanned: documents.length,
    findings: ordered,
    counts,
    failOn,
    verdict: ordered.some(finding => atOrAbove(finding.tier, failOn)) ? 'fail' : 'pass',
  }
}

/**
 * Read one tier name.
 * @param value - the text to read, or `undefined`.
 * @param fallback - the tier to use when the text names none.
 * @returns the tier.
 */
export function asTier(value: string | undefined, fallback: LintTier): LintTier {
  return TIERS.find(tier => tier === value) ?? fallback
}

/**
 * Run the gate over one library.
 * @param root - absolute library root.
 * @param failOn - the tier the caller is willing to fail on.
 * @returns the report.
 */
export async function readLintReport(root: string, failOn: LintTier): Promise<LintReport> {
  const documents = await listCardDocuments(root)
  const index = await readIndexSummary(root)
  return lintCards(documents, { indexTotalCards: index.totalCards }, failOn)
}
