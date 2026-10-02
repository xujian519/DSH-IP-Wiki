/** The wire parser: what the host sends is read back, and what it must refuse. */
import { afterEach, describe, expect, it } from 'vitest'
import { readTree } from '../src/host/library'
import {
  parseCardDocumentPayload,
  parseCardSummary,
  parseIndexBuild,
  parseLibraryTree,
  parseLintReport,
  parseReportDocument,
  parseReportList,
  parseCardDraft,
  parseConfirmResult,
  parseDraftList,
  parseDraftView,
  parseDeleteResult,
  parseRevertResult,
  parseSearchResult,
  parseSearchStatus,
} from '../src/shared/parse'
import { makeLibrary, REPORT, RULE_CARD } from './fixtures'
import { parseFrontmatter } from '../src/shared/frontmatter'

const created: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map(async dispose => { await dispose() }))
})

/**
 * Write a throwaway library and record it for cleanup.
 * @returns the fixture.
 */
async function library(): Promise<Awaited<ReturnType<typeof makeLibrary>>> {
  const fixture = await makeLibrary()
  created.push(fixture.dispose)
  return fixture
}

/** What `JSON.parse(JSON.stringify(...))` turns a value into on the wire. */
function onTheWire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}

describe('parseLibraryTree', () => {
  it('reads back what the host reader produced', async () => {
    const fixture = await library()
    const tree = await readTree(fixture.root)
    expect(parseLibraryTree(onTheWire(tree))).toEqual(tree)
  })

  it('refuses a payload that is not an object', () => {
    expect(() => parseLibraryTree('nope')).toThrow(/tree is not an object/u)
  })

  it('refuses a payload without a status', () => {
    expect(() => parseLibraryTree({})).toThrow(/status is not an object/u)
  })

  it('fills documented defaults for absent optional fields', () => {
    const parsed = parseLibraryTree({ status: {}, branches: [] })
    expect(parsed.status).toEqual({
      root: '',
      exists: false,
      counts: { total: 0, byType: {}, byDomain: {}, byStatus: {} },
      indexGeneratedAt: undefined,
      indexTotalCards: undefined,
      indexDrift: 'unreadable',
      reports: [],
      needsReview: [],
      problem: '',
    })
  })

  it('reads each drift verdict and defaults an unknown one', () => {
    const drift = (value: unknown): string => parseLibraryTree({ status: { indexDrift: value } }).status.indexDrift
    expect(drift('none')).toBe('none')
    expect(drift('missing')).toBe('missing')
    expect(drift('count-mismatch')).toBe('count-mismatch')
    expect(drift('unreadable')).toBe('unreadable')
    expect(drift('something')).toBe('unreadable')
  })

  it('ignores count entries that are not numbers', () => {
    const parsed = parseLibraryTree({ status: { counts: { total: 3, byType: { rule: 2, odd: 'x' } } } })
    expect(parsed.status.counts.total).toBe(3)
    expect(parsed.status.counts.byType).toEqual({ rule: 2 })
  })

  it('reads counts that are not a map as empty', () => {
    const parsed = parseLibraryTree({ status: { counts: { byType: 7 } } })
    expect(parsed.status.counts.byType).toEqual({})
  })

  it('defaults a branch total from its groups and its label from its type', () => {
    const parsed = parseLibraryTree({
      status: {},
      branches: [{ type: 'rule', groups: [{ key: 'k', label: 'l', cards: [{ type: 'rule' }] }] }],
    })
    expect(parsed.branches[0]?.label).toBe('rule')
    expect(parsed.branches[0]?.total).toBe(1)
  })

  it('defaults a group key and label when the payload carries none', () => {
    const parsed = parseLibraryTree({
      status: {},
      branches: [{ type: 'rule', groups: [{ cards: [] }] }],
    })
    expect(parsed.branches[0]?.groups[0]).toEqual({ key: 'rule#0', label: 'rule#0', cards: [] })
  })

  it('refuses a branch whose card kind is unknown', () => {
    expect(() => parseLibraryTree({ status: {}, branches: [{ type: 'note' }] }))
      .toThrow(/branch carries no known type/u)
  })

  it('reads review entries that carry their confidence', () => {
    const parsed = parseLibraryTree({
      status: { needsReview: [{ type: 'rule', path: 'cards/a.md', confidence: 0.4 }] },
    })
    expect(parsed.status.needsReview[0]?.confidence).toBe(0.4)
  })

  it('refuses a review entry without the confidence that queued it', () => {
    expect(() => parseLibraryTree({ status: { needsReview: [{ type: 'rule', path: 'cards/a.md' }] } }))
      .toThrow('dsh-ip-wiki: review entry cards/a.md carries no confidence')
  })
})

describe('parseCardSummary', () => {
  it('reads a card and its documented defaults', () => {
    const summary = parseCardSummary({ type: 'rule', path: 'cards/rule/a.md' })
    expect(summary).toEqual({
      id: '',
      type: 'rule',
      title: '',
      domainL1: '',
      domainL2: '',
      concept: '',
      status: 'draft',
      confidence: undefined,
      quality: undefined,
      path: 'cards/rule/a.md',
      relatedCount: 0,
    })
  })

  it('reads the confirmed and deprecated statuses', () => {
    expect(parseCardSummary({ type: 'rule', status: 'confirmed' }).status).toBe('confirmed')
    expect(parseCardSummary({ type: 'rule', status: 'deprecated' }).status).toBe('deprecated')
    expect(parseCardSummary({ type: 'rule', status: 'nonsense' }).status).toBe('draft')
  })

  it('refuses a card whose kind is unknown, naming its path', () => {
    expect(() => parseCardSummary({ type: 'note', path: 'cards/x.md' }))
      .toThrow('dsh-ip-wiki: card cards/x.md carries no known type')
  })

  it('refuses a non-object', () => {
    expect(() => parseCardSummary(null)).toThrow(/card is not an object/u)
  })
})

describe('parseCardDocumentPayload', () => {
  it('reads a document the host reader produced', async () => {
    const fixture = await library()
    const { fields, body } = parseFrontmatter(RULE_CARD)
    const document = {
      id: fields['id'],
      type: 'rule',
      title: '标题',
      domainL1: '专利',
      domainL2: 'OA 答复',
      concept: '三步法',
      status: 'confirmed',
      confidence: 0.9,
      quality: 0.92,
      path: 'cards/rule/rule-1.md',
      relatedCount: 2,
      body,
      lawRefs: ['专利法第 22 条第 3 款'],
      relatedConcepts: ['old-1', 'old-2'],
      wikiLinks: [],
      jurisdiction: 'CN',
      fromId: '',
      supersededBy: '',
      sourcePath: '/vault/cards/rule-1.md',
      needsReview: true,
    }
    const parsed = parseCardDocumentPayload(onTheWire(document))
    expect(parsed).toEqual(document)
    await fixture.dispose()
  })

  it('defaults absent lists and flags', () => {
    const parsed = parseCardDocumentPayload({ type: 'rule' })
    expect(parsed.lawRefs).toEqual([])
    expect(parsed.relatedConcepts).toEqual([])
    expect(parsed.body).toBe('')
    expect(parsed.needsReview).toBe(false)
  })
})

describe('parseReportDocument and parseReportList', () => {
  it('reads a report', () => {
    expect(parseReportDocument({ name: 'r.md', text: REPORT })).toEqual({ name: 'r.md', text: REPORT })
  })

  it('refuses a report that is not an object', () => {
    expect(() => parseReportDocument(7)).toThrow(/report is not an object/u)
  })

  it('reads the report list and drops non-text entries', () => {
    expect(parseReportList({ reports: ['a.md', 3, 'b.md'] })).toEqual(['a.md', 'b.md'])
  })

  it('reads a missing report list as empty', () => {
    expect(parseReportList({})).toEqual([])
  })

  it('refuses a report list that is not an object', () => {
    expect(() => parseReportList([])).toThrow(/reports is not an object/u)
  })
})

describe('parseSearchResult and parseSearchStatus', () => {
  /** One hit the host would send. */
  const HIT = {
    path: 'cards/rule/a.md',
    title: '三步法',
    type: 'rule',
    domainL2: 'OA 答复',
    concept: '三步法',
    lawRefs: ['专利法第 22 条第 3 款'],
    sourcePath: '/vault/a.md',
    score: 0.9,
    matched: ['keyword', 'vector', 'rerank'],
    snippet: '片段',
  }

  it('reads a search answer', () => {
    expect(parseSearchResult({ query: '三步法', mode: 'rerank', degraded: '', scanned: 2, deprecated: 3, duplicates: 4, hits: [HIT] })).toEqual({
      query: '三步法',
      mode: 'rerank',
      degraded: '',
      scanned: 2,
      deprecated: 3,
      duplicates: 4,
      hits: [{
        path: 'cards/rule/a.md',
        title: '三步法',
        type: 'rule',
        domainL2: 'OA 答复',
        concept: '三步法',
        lawRefs: ['专利法第 22 条第 3 款'],
        sourcePath: '/vault/a.md',
        status: 'draft',
        score: 0.9,
        matched: ['keyword', 'vector', 'rerank'],
        snippet: '片段',
      }],
    })
  })

  it('fills documented defaults and drops a stage name it does not know', () => {
    const parsed = parseSearchResult({ mode: 'keyword', hits: [{ type: 'rule', matched: ['keyword', 'fuzzy'] }] })
    expect(parsed).toEqual({
      query: '',
      mode: 'keyword',
      degraded: '',
      scanned: 0,
      deprecated: 0,
      duplicates: 0,
      hits: [{
        path: '',
        title: '',
        type: 'rule',
        domainL2: '',
        concept: '',
        lawRefs: [],
        sourcePath: '',
        status: 'draft',
        score: 0,
        matched: ['keyword'],
        snippet: '',
      }],
    })
  })

  it('keeps a status the host sent', () => {
    const parsed = parseSearchResult({ mode: 'keyword', hits: [{ type: 'rule', status: 'confirmed' }] })
    expect(parsed.hits[0]?.status).toBe('confirmed')
  })

  it('refuses a search answer that names no known stage', () => {
    expect(() => parseSearchResult({ mode: 'fuzzy' })).toThrow('dsh-ip-wiki: search result names no known stage: fuzzy')
  })

  it('refuses a search answer that is not an object', () => {
    expect(() => parseSearchResult(3)).toThrow(/search result is not an object/u)
  })

  it('refuses a hit that carries no known card kind', () => {
    expect(() => parseSearchResult({ mode: 'keyword', hits: [{ type: 'note', path: 'x' }] }))
      .toThrow(/card x carries no known type/u)
  })

  it('reads the retrieval status', () => {
    expect(parseSearchStatus({ semantic: true })).toEqual({ semantic: true, reason: '', embedModel: '', warmed: 0, total: 0 })
    expect(parseSearchStatus({ semantic: false, reason: '未配置', embedModel: 'm' }))
      .toEqual({ semantic: false, reason: '未配置', embedModel: 'm', warmed: 0, total: 0 })
    // Warming progress crosses the wire, so the panel can say how much of the corpus the
    // semantic stage has seen; a payload that names neither counts as nothing warmed.
    expect(parseSearchStatus({ semantic: true, warmed: 12, total: 40 }))
      .toEqual({ semantic: true, reason: '', embedModel: '', warmed: 12, total: 40 })
  })

  it('refuses a retrieval status that is not an object', () => {
    expect(() => parseSearchStatus('x')).toThrow(/search status is not an object/u)
  })
})

describe('the draft parsers', () => {
  /** One draft the host would send. */
  const DRAFT = {
    id: 'abc',
    kind: 'merge',
    target: 'cards/rule/new.md',
    type: 'rule',
    title: '拟新增',
    content: '---\ntype: rule\n---\n',
    supersedes: ['cards/rule/old.md'],
    classification: 'client-material',
    generatedBy: 'local-model',
    policy: 'local-only',
    sourceRef: '/in.pdf',
    note: '来自 PDF',
    createdAt: '2026-09-29T00:00:00.000Z',
    status: 'pending',
    confirmedAt: undefined,
    revertedAt: undefined,
  }

  it('reads a draft', () => {
    expect(parseCardDraft(DRAFT)).toEqual({ ...DRAFT, confirmedAt: undefined, revertedAt: undefined })
  })

  it('reads a draft kind and the cards it absorbs', () => {
    expect(parseCardDraft(DRAFT)).toMatchObject({ kind: 'merge', supersedes: ['cards/rule/old.md'] })
    expect(parseCardDraft({ type: 'rule', supersedes: ['a', 3, 'b'] }).supersedes).toEqual(['a', 'b'])
  })

  it('reads every closed value it does not recognise as its safe default', () => {
    const parsed = parseCardDraft({
      type: 'rule',
      classification: 'other',
      generatedBy: 'other',
      policy: 'other',
      status: 'other',
      confirmedAt: 'now',
    })
    expect(parsed).toMatchObject({
      classification: 'public',
      generatedBy: 'human',
      policy: 'dsh-model-allowed',
      status: 'pending',
      confirmedAt: 'now',
    })
    expect(parseCardDraft({ type: 'rule', generatedBy: 'dsh-model' }).generatedBy).toBe('dsh-model')
    expect(parseCardDraft({ type: 'rule', status: 'confirmed' }).status).toBe('confirmed')
    expect(parseCardDraft({ type: 'rule', status: 'discarded' }).status).toBe('discarded')
  })

  it('refuses a draft that is not an object', () => {
    expect(() => parseCardDraft(3)).toThrow(/draft is not an object/u)
  })

  it('reads a draft view and its difference', () => {
    const parsed = parseDraftView({
      draft: DRAFT,
      diff: [{ kind: 'added', text: 'a' }, { kind: 'removed', text: 'b' }, { kind: 'other', text: 'c' }],
      counts: { added: 1, removed: 2 },
      existing: true,
    })
    expect(parsed.counts).toEqual({ added: 1, removed: 2 })
    expect(parsed.existing).toBe(true)
    expect(parsed.diff.map(line => line.kind)).toEqual(['added', 'removed', 'same'])
  })

  it('fills absent counts and an absent difference', () => {
    const parsed = parseDraftView({ draft: DRAFT })
    expect(parsed.counts).toEqual({ added: 0, removed: 0 })
    expect(parsed.diff).toEqual([])
    expect(parsed.existing).toBe(false)
  })

  it('refuses a draft view that is not an object', () => {
    expect(() => parseDraftView('x')).toThrow(/draft view is not an object/u)
  })

  it('reads a draft list', () => {
    expect(parseDraftList({ drafts: [DRAFT] })).toHaveLength(1)
    expect(parseDraftList({})).toEqual([])
    expect(() => parseDraftList(3)).toThrow(/drafts is not an object/u)
  })

  it('reads a confirm result and defaults an unknown action', () => {
    expect(parseConfirmResult({
      path: 'cards/rule/a.md', action: 'replaced', backup: 'b', deprecated: ['cards/rule/old.md'],
    })).toEqual({
      path: 'cards/rule/a.md', action: 'replaced', backup: 'b', deprecated: ['cards/rule/old.md'],
    })
    expect(parseConfirmResult({ action: 'other' }))
      .toEqual({ path: '', action: 'created', backup: undefined, deprecated: [] })
    expect(() => parseConfirmResult(3)).toThrow(/confirm is not an object/u)
  })

  it('reads a revert result and defaults an unknown action', () => {
    expect(parseRevertResult({ path: 'cards/rule/a.md', action: 'restored', restored: ['cards/rule/old.md'] }))
      .toEqual({ path: 'cards/rule/a.md', action: 'restored', restored: ['cards/rule/old.md'] })
    expect(parseRevertResult({ action: 'other' })).toEqual({ path: '', action: 'deleted', restored: [] })
    expect(() => parseRevertResult(3)).toThrow(/revert is not an object/u)
  })

  it('reads a delete result and refuses one that names no card', () => {
    expect(parseDeleteResult({ path: 'cards/rule/a.md', title: '要删的卡', stripped: ['cards/rule/b.md'], totalCards: 4 }))
      .toEqual({ path: 'cards/rule/a.md', title: '要删的卡', stripped: ['cards/rule/b.md'], totalCards: 4 })
    // A payload that carries only the path still describes a deletion.
    expect(parseDeleteResult({ path: 'cards/rule/a.md' }))
      .toEqual({ path: 'cards/rule/a.md', title: '', stripped: [], totalCards: 0 })
    expect(() => parseDeleteResult({ title: '要删的卡' })).toThrow(/carries no path/u)
    expect(() => parseDeleteResult({ path: '' })).toThrow(/carries no path/u)
    expect(() => parseDeleteResult(3)).toThrow(/delete is not an object/u)
  })
})

describe('parseLintReport', () => {
  it('reads a gate report', () => {
    const report = parseLintReport({
      scanned: 30,
      findings: [{ tier: 'warning', code: 'broken-link', message: '断链', path: 'cards/rule/a.md' }],
      counts: { critical: 0, warning: 1, suggestion: 0 },
      failOn: 'warning',
      verdict: 'fail',
    })
    expect(report).toEqual({
      scanned: 30,
      findings: [{ tier: 'warning', code: 'broken-link', message: '断链', path: 'cards/rule/a.md' }],
      counts: { critical: 0, warning: 1, suggestion: 0 },
      failOn: 'warning',
      verdict: 'fail',
    })
  })

  it('defaults unknown tiers, a missing verdict, and absent counts', () => {
    const report = parseLintReport({ findings: [{ tier: 'nonsense' }, {}], failOn: 'nonsense' })
    expect(report.findings[0]).toEqual({ tier: 'suggestion', code: '', message: '', path: '' })
    expect(report.findings[1]).toEqual({ tier: 'suggestion', code: '', message: '', path: '' })
    expect(report.failOn).toBe('suggestion')
    expect(report.verdict).toBe('pass')
    expect(report.counts).toEqual({ critical: 0, warning: 0, suggestion: 0 })
  })

  it('reads the critical tier and a failing verdict', () => {
    const report = parseLintReport({
      findings: [{ tier: 'critical' }],
      counts: { critical: 3 },
      failOn: 'critical',
      verdict: 'fail',
    })
    expect(report.findings[0]?.tier).toBe('critical')
    expect(report.counts.critical).toBe(3)
    expect(report.verdict).toBe('fail')
  })

  it('refuses a gate report that is not an object', () => {
    expect(() => parseLintReport(3)).toThrow(/lint report is not an object/u)
  })
})

describe('parseIndexBuild', () => {
  it('reads the rebuild result', () => {
    expect(parseIndexBuild({
      path: 'index/card-index.json',
      totalCards: 31,
      byType: { rule: 26, concept: 5 },
      byDomain: { 'OA 答复': 20 },
      backup: '.dsh-ip-wiki/backups/index/x.json',
    })).toEqual({
      totalCards: 31,
      byType: { rule: 26, concept: 5 },
      byDomain: { 'OA 答复': 20 },
      backup: '.dsh-ip-wiki/backups/index/x.json',
    })
  })

  it('defaults absent counts and a missing backup', () => {
    expect(parseIndexBuild({})).toEqual({ totalCards: 0, byType: {}, byDomain: {}, backup: '' })
    expect(parseIndexBuild({ byType: 3, byDomain: [1] }))
      .toMatchObject({ byType: {}, byDomain: {} })
  })

  it('refuses a payload that is not an object', () => {
    expect(() => parseIndexBuild(3)).toThrow(/index build is not an object/u)
  })
})
