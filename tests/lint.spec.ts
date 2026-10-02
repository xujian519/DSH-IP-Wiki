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
    wikiLinks: [],
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

  it('reports a target enough cards point at without the library having a card for it', () => {
    // On the real library the head is a page the vault kept linking to but never
    // imported as a card — 专利实务/创造性/创造性-概述与三步法框架, named by 50 cards.
    // Ten cards is the threshold; eleven clears it, ten clears it, and two counts that
    // tie fall back to alphabetical order.
    const documents = [card({ path: 'cards/rule/anchor.md' })]
    for (let index = 1; index <= 11; index += 1) {
      documents.push(card({
        path: `cards/rule/a-${String(index)}.md`,
        relatedConcepts: ['cards/rule/anchor.md'],
        wikiLinks: [
          '创造性-概述与三步法框架',
          ...(index <= 10 ? ['zeta-missing', 'alpha-missing'] : []),
        ],
      }))
    }
    const report = lintCards(documents, { indexTotalCards: documents.length }, 'warning')
    expect(report.findings).toEqual([
      { tier: 'suggestion', code: 'wanted-card', message: '11 张卡提到、但库里没有对应的卡：创造性-概述与三步法框架', path: '' },
      { tier: 'suggestion', code: 'wanted-card', message: '10 张卡提到、但库里没有对应的卡：alpha-missing', path: '' },
      { tier: 'suggestion', code: 'wanted-card', message: '10 张卡提到、但库里没有对应的卡：zeta-missing', path: '' },
    ])
    expect(report.verdict).toBe('pass')
  })

  it('leaves a missing target out once a card answers it', () => {
    // A card may have been created since the import wrote the link, and a target that
    // found its card has to leave the report on its own — otherwise this rule never clears.
    const documents = [card({ path: 'cards/rule/专利法第22条第2款.md', title: '专利法第22条第2款' })]
    for (let index = 1; index <= 10; index += 1) {
      documents.push(card({
        path: `cards/rule/b-${String(index)}.md`,
        relatedConcepts: ['cards/rule/专利法第22条第2款.md'],
        wikiLinks: ['专利法第22条第2款'],
      }))
    }
    const report = lintCards(documents, { indexTotalCards: documents.length }, 'warning')
    expect(codes(report.findings)).toEqual([])
  })

  it('ignores a target below the threshold, an empty one, and a repeat inside one card', () => {
    const documents = [card({ path: 'cards/rule/anchor.md' })]
    for (let index = 1; index <= 4; index += 1) {
      documents.push(card({
        path: `cards/rule/c-${String(index)}.md`,
        relatedConcepts: ['cards/rule/anchor.md'],
        wikiLinks: ['被反复提起的目标', ''],
      }))
    }
    documents.push(card({
      path: 'cards/rule/c-repeat.md',
      relatedConcepts: ['cards/rule/anchor.md'],
      // Six mentions inside one card are still one card pointing at the target, so this
      // counts as five. Counting the repeats would put it at ten and let one card's
      // enthusiasm alone trip the rule.
      wikiLinks: Array.from({ length: 6 }, () => '被反复提起的目标').concat(''),
    }))
    const report = lintCards(documents, { indexTotalCards: documents.length }, 'warning')
    expect(codes(report.findings)).toEqual([])
  })

  it('reports a domain no live reference crosses and leaves the others alone', () => {
    const documents: CardDocument[] = []
    // 孤岛: five cards that reference each other and nothing else. One of those
    // references lands on a superseded card, which is not the live library and so does
    // not carry the island back into the rest of the graph.
    documents.push(card({
      path: 'cards/rule/retired.md',
      domainL2: '桥梁',
      status: 'deprecated',
      supersededBy: 'cards/rule/bridge.md',
    }))
    for (let index = 1; index <= 5; index += 1) {
      const peer = index === 1 ? 2 : 1
      documents.push(card({
        path: `cards/rule/island-${String(index)}.md`,
        domainL2: '孤岛',
        relatedConcepts: index === 1
          ? [`cards/rule/island-${String(peer)}.md`, 'cards/rule/retired.md']
          : [`cards/rule/island-${String(peer)}.md`],
      }))
    }
    // 腹地 reaches into 桥梁, so neither of those is an island.
    for (let index = 1; index <= 5; index += 1) {
      documents.push(card({
        path: `cards/rule/main-${String(index)}.md`,
        domainL2: '腹地',
        relatedConcepts: index === 1
          ? ['cards/rule/bridge.md']
          : [`cards/rule/main-${String(index === 2 ? 3 : 2)}.md`],
      }))
    }
    documents.push(card({ path: 'cards/rule/bridge.md', domainL2: '桥梁' }))
    // 小域 is isolated too, but two cards is below the floor; small-a also points at
    // itself, which is not a reference to anything else.
    documents.push(card({ path: 'cards/rule/small-a.md', domainL2: '小域', relatedConcepts: ['cards/rule/small-b.md', 'cards/rule/small-a.md'] }))
    documents.push(card({ path: 'cards/rule/small-b.md', domainL2: '小域' }))
    const report = lintCards(documents, { indexTotalCards: documents.length }, 'warning')
    expect(report.findings).toEqual([{
      tier: 'suggestion',
      code: 'island-domain',
      message: '5 张卡的域与其它域没有任何互链（domain_l2）：孤岛',
      path: '',
    }])
  })

  it('says nothing about isolation in a library with a single domain', () => {
    // With one domain there is no other domain to be cut off from: the statement would
    // be vacuously true for every library nobody has classified yet.
    const documents = Array.from({ length: 6 }, (_, index) => card({ path: `cards/rule/only-${String(index)}.md` }))
    const report = lintCards(documents, { indexTotalCards: documents.length }, 'warning')
    expect(codes(report.findings)).toEqual(['orphan-card', 'orphan-card', 'orphan-card', 'orphan-card', 'orphan-card', 'orphan-card'])
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
