/** The quality gate: one case per rule, and the three failure cases the plan names. */
import { afterEach, describe, expect, it } from 'vitest'
import { asTier, duplicateGroups, lintCards, readLintReport, type LintTier } from '../src/host/lint'
import type { CardDocument } from '../src/shared/card'
import { makeLibrary, type FixtureLibrary } from './fixtures'

/** Libraries created by the running test, removed afterwards. */
const created: FixtureLibrary[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map(async fixture => { await fixture.dispose() }))
})

/**
 * Write a throwaway library.
 * @returns the fixture.
 */
async function library(): Promise<FixtureLibrary> {
  const fixture = await makeLibrary()
  created.push(fixture)
  return fixture
}

/** A card with every field filled, so a test only states what it is about. */
function card(overrides: Partial<CardDocument> & { readonly path: string }): CardDocument {
  return {
    id: overrides.path,
    type: 'rule',
    // Unique per path, so a test that is about something else cannot trip the
    // duplicate-title rule by accident.
    title: `标题 ${overrides.path}`,
    domainL1: '专利',
    domainL2: 'OA 答复',
    concept: '概念',
    status: 'confirmed',
    confidence: 0.9,
    quality: 0.9,
    relatedCount: 0,
    body: '正文。',
    lawRefs: [],
    relatedConcepts: [],
    jurisdiction: 'CN',
    fromId: '',
    supersededBy: '',
    sourcePath: '',
    needsReview: false,
    ...overrides,
  }
}

/** The codes a report holds, in order. */
function codes(findings: readonly { readonly code: string }[]): string[] {
  return findings.map(finding => finding.code)
}

describe('lintCards', () => {
  it('passes a library whose cards are complete and reachable', () => {
    const report = lintCards([
      card({ path: 'cards/rule/a.md', relatedConcepts: ['cards/rule/b.md'] }),
      card({ path: 'cards/rule/b.md' }),
    ], { indexTotalCards: 2 }, 'warning')
    expect(report.findings).toEqual([])
    expect(report.verdict).toBe('pass')
    expect(report.scanned).toBe(2)
    expect(report.counts).toEqual({ critical: 0, warning: 0, suggestion: 0 })
  })

  it('calls a card without a title and a card without a body critical', () => {
    const report = lintCards([
      card({ path: 'cards/rule/a.md', title: '', relatedConcepts: ['cards/rule/b.md'] }),
      card({ path: 'cards/rule/b.md', body: '   ' }),
    ], { indexTotalCards: 2 }, 'warning')
    expect(codes(report.findings)).toEqual(['empty-body', 'missing-title'])
    expect(report.counts.critical).toBe(2)
    expect(report.verdict).toBe('fail')
  })

  it('reports a cross-reference that resolves to nothing', () => {
    const report = lintCards([
      card({ path: 'cards/rule/a.md', relatedConcepts: ['cards/rule/gone.md'] }),
    ], { indexTotalCards: 1 }, 'warning')
    expect(report.findings).toEqual([{
      tier: 'warning',
      code: 'broken-link',
      message: '关联卡片指向不存在的卡：cards/rule/gone.md',
      path: 'cards/rule/a.md',
    }])
  })

  it('resolves a cross-reference by the card id and by its pre-migration id', () => {
    const report = lintCards([
      card({ path: 'cards/rule/a.md', id: 'rule-a', relatedConcepts: ['rule-b', 'old-b'] }),
      card({ path: 'cards/rule/b.md', id: 'rule-b', fromId: 'old-b' }),
    ], { indexTotalCards: 2 }, 'warning')
    expect(report.findings).toEqual([])
  })

  it('reports every card that shares a title, ignoring punctuation', () => {
    const report = lintCards([
      card({ path: 'cards/rule/a.md', title: '三步法：怎么用？', relatedConcepts: ['cards/rule/b.md'] }),
      card({ path: 'cards/rule/b.md', title: '三步法怎么用' }),
    ], { indexTotalCards: 2 }, 'critical')
    expect(codes(report.findings)).toEqual(['duplicate-title', 'duplicate-title'])
    expect(report.findings[0]?.message).toContain('2 张')
    expect(report.verdict).toBe('pass')
  })

  it('leaves superseded cards out of the duplicate and orphan rules', () => {
    const superseded = lintCards([
      card({ path: 'cards/rule/a.md', title: '同题', status: 'deprecated', supersededBy: 'cards/rule/b.md' }),
      card({ path: 'cards/rule/b.md', title: '同题' }),
      card({ path: 'cards/rule/c.md', title: '别的', status: 'deprecated' }),
    ], { indexTotalCards: 3 }, 'warning')
    // The superseded twin no longer counts as a duplicate, and the superseded card
    // with no links is history rather than an orphan; the live card still is one.
    expect(codes(superseded.findings)).toEqual(['orphan-card'])
    expect(superseded.findings[0]?.path).toBe('cards/rule/b.md')
  })

  it('suggests what a human should look at: classification, concept, confidence, and orphans', () => {
    const report = lintCards([
      card({ path: 'cards/rule/a.md', domainL2: '未分类', concept: '', confidence: 0.35 }),
      card({ path: 'cards/rule/b.md', domainL2: '', relatedConcepts: ['cards/rule/a.md'] }),
    ], { indexTotalCards: 2 }, 'critical')
    expect(codes(report.findings)).toEqual([
      'low-confidence', 'missing-concept', 'unclassified', 'unclassified',
    ])
    expect(report.counts.suggestion).toBe(4)
    expect(report.verdict).toBe('pass')
  })

  it('reports a card nobody links to and that links to nobody', () => {
    const report = lintCards([
      card({ path: 'cards/rule/a.md', relatedConcepts: ['cards/rule/b.md'] }),
      card({ path: 'cards/rule/b.md' }),
      card({ path: 'cards/rule/lonely.md' }),
    ], { indexTotalCards: 3 }, 'warning')
    expect(report.findings).toEqual([{
      tier: 'suggestion',
      code: 'orphan-card',
      message: '孤立卡片：既没有关联卡片，也没有被任何卡片关联',
      path: 'cards/rule/lonely.md',
    }])
  })

  it('reports an index that is missing or out of step', () => {
    const missing = lintCards([card({ path: 'cards/rule/a.md' })], { indexTotalCards: undefined }, 'warning')
    expect(codes(missing.findings)).toEqual(['index-missing', 'orphan-card'])
    const drifted = lintCards([card({ path: 'cards/rule/a.md' })], { indexTotalCards: 30 }, 'warning')
    expect(drifted.findings[0]?.message).toContain('索引 30 / 磁盘 1')
    expect(drifted.verdict).toBe('fail')
  })

  it('reads the same library the same way twice', () => {
    const documents = [card({ path: 'cards/rule/a.md', title: '', concept: '' })]
    expect(lintCards(documents, { indexTotalCards: 1 }, 'warning'))
      .toEqual(lintCards(documents, { indexTotalCards: 1 }, 'warning'))
  })

  it('orders findings by tier, then code, then path', () => {
    const report = lintCards([
      card({ path: 'cards/rule/a.md', title: '', domainL2: '未分类' }),
      card({ path: 'cards/rule/b.md', title: 'B', relatedConcepts: ['nope'] }),
    ], { indexTotalCards: 2 }, 'warning')
    expect(report.findings.map(finding => finding.tier)).toEqual(['critical', 'warning', 'suggestion', 'suggestion'])
    expect(codes(report.findings)).toEqual(['missing-title', 'broken-link', 'orphan-card', 'unclassified'])
  })

  for (const [failOn, verdict] of [['critical', 'pass'], ['warning', 'fail'], ['suggestion', 'fail']] as const) {
    it(`decides the verdict at failOn=${failOn}`, () => {
      const report = lintCards([card({ path: 'cards/rule/a.md' })], { indexTotalCards: 30 }, failOn as LintTier)
      expect(report.verdict).toBe(verdict)
      expect(report.failOn).toBe(failOn)
    })
  }
})

describe('duplicateGroups', () => {
  it('groups the cards that share a title once punctuation is gone', () => {
    const groups = duplicateGroups([
      card({ path: 'cards/rule/a.md', title: '三步法：怎么用？' }),
      card({ path: 'cards/rule/b.md', title: '三步法怎么用' }),
      card({ path: 'cards/rule/c.md', title: '别的问题' }),
    ])
    expect(groups).toEqual([{ title: '三步法：怎么用？', paths: ['cards/rule/a.md', 'cards/rule/b.md'] }])
  })

  it('treats two spellings of one question as one candidate, particle included', () => {
    const groups = duplicateGroups([
      card({ path: 'cards/rule/a.md', title: '如何否定权利要求创造性？' }),
      card({ path: 'cards/rule/b.md', title: '如何否定权利要求的创造性？' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.paths).toEqual(['cards/rule/a.md', 'cards/rule/b.md'])
  })

  it('leaves untitled cards to the missing-title rule', () => {
    expect(duplicateGroups([
      card({ path: 'cards/rule/a.md', title: '' }),
      card({ path: 'cards/rule/b.md', title: '' }),
    ])).toEqual([])
  })

  it('orders groups by size and answers a library with no duplicates', () => {
    // Two groups of the same size, so the title decides their order.
    const groups = duplicateGroups([
      card({ path: 'a.md', title: '甲' }),
      card({ path: 'b.md', title: '甲' }),
      card({ path: 'c.md', title: '乙' }),
      card({ path: 'd.md', title: '乙' }),
      card({ path: 'e.md', title: '丙' }),
    ])
    expect(groups.map(group => group.paths.length)).toEqual([2, 2])
    expect(groups.map(group => group.title)).toEqual(['乙', '甲'])
    expect(groups[0]?.paths).toEqual(['c.md', 'd.md'])
    expect(duplicateGroups([card({ path: 'a.md', title: '独一无二' })])).toEqual([])
  })
})

describe('asTier', () => {
  it('reads a known tier and falls back otherwise', () => {
    expect(asTier('critical', 'warning')).toBe('critical')
    expect(asTier('suggestion', 'warning')).toBe('suggestion')
    expect(asTier('nonsense', 'warning')).toBe('warning')
    expect(asTier(undefined, 'suggestion')).toBe('suggestion')
  })
})

describe('readLintReport', () => {
  it('reads a library whose index agrees with its cards', async () => {
    const fixture = await library()
    const report = await readLintReport(fixture.root, 'warning')
    expect(report.scanned).toBe(2)
    expect(codes(report.findings)).not.toContain('index-drift')
  })

  it('reports drift against a stale index', async () => {
    const fixture = await makeLibrary({ indexTotal: 30 })
    created.push(fixture)
    const report = await readLintReport(fixture.root, 'warning')
    expect(codes(report.findings)).toContain('index-drift')
    expect(report.verdict).toBe('fail')
  })
})
