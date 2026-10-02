/**
 * The library quality gate must go red on the three defects the plan names.
 *
 * A gate nobody has seen fail is decoration: this spec writes a real library on
 * disk, injects an orphan card, a broken cross-reference, and index drift, then
 * requires the report to name each one at its tier and the verdict to flip with the
 * failure line.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readLintReport, type LintFinding } from '../../src/host/lint'
import { makeLibrary } from '../fixtures'

/** The card text one injected defect needs. */
function cardText(fields: readonly string[], body = '正文。'): string {
  return ['---', ...fields, '---', '', '# 注入用例', '', body, ''].join('\n')
}

/** The finding for one code, or a failure naming what the report held instead. */
function findingFor(findings: readonly LintFinding[], code: string): LintFinding {
  const found = findings.find(finding => finding.code === code)
  if (found === undefined) {
    throw new Error(`expected a ${code} finding, got ${findings.map(item => item.code).join(', ') || 'none'}`)
  }
  return found
}

describe('the library quality gate', () => {
  it('names an orphan card, a broken link, and index drift, and flips its verdict', async () => {
    const fixture = await makeLibrary({ indexTotal: 2 })
    try {
      // A card nobody links to and that links to nobody.
      await writeFile(join(fixture.root, 'cards', 'rule', 'orphan.md'), cardText([
        'id: "orphan"',
        'type: "rule"',
        'title: "孤立卡"',
        'domain_l2: "OA 答复"',
        'concept: "孤立"',
      ]))
      // A card whose cross-reference resolves to nothing.
      await writeFile(join(fixture.root, 'cards', 'rule', 'broken.md'), cardText([
        'id: "broken"',
        'type: "rule"',
        'title: "断链卡"',
        'domain_l2: "OA 答复"',
        'concept: "断链"',
        'related_concepts:',
        '  - "cards/rule/gone.md"',
      ]))
      // An index that claims a different library.
      await writeFile(join(fixture.root, 'index', 'card-index.json'),
        JSON.stringify({ schema_version: 1, generated_at: '2026-09-29T00:00:00.000Z', total_cards: 99 }))

      const report = await readLintReport(fixture.root, 'warning')
      expect(report.scanned).toBe(4)
      // The fixture's own two cards already carry broken cross-references into the
      // pre-migration ids, so each rule is asserted by the path it named.
      expect(report.findings.filter(item => item.code === 'orphan-card').map(item => item.path))
        .toContain('cards/rule/orphan.md')
      expect(findingFor(report.findings, 'orphan-card').tier).toBe('suggestion')
      expect(report.findings.filter(item => item.code === 'broken-link').map(item => item.path))
        .toContain('cards/rule/broken.md')
      expect(findingFor(report.findings, 'broken-link').tier).toBe('warning')
      expect(findingFor(report.findings, 'index-drift').message).toContain('索引 99 / 磁盘 4')
      expect(report.verdict).toBe('fail')

      // The same library passes a gate that only fails on critical findings.
      const lenient = await readLintReport(fixture.root, 'critical')
      expect(lenient.counts.critical).toBe(0)
      expect(lenient.verdict).toBe('pass')

      // And it fails again the moment a critical defect appears.
      // No body at all, which is what a card that says nothing looks like.
      await writeFile(join(fixture.root, 'cards', 'rule', 'empty.md'),
        '---\nid: "empty"\ntype: "rule"\ntitle: "空正文卡"\ndomain_l2: "OA 答复"\nconcept: "空"\n---\n')
      const strict = await readLintReport(fixture.root, 'critical')
      expect(findingFor(strict.findings, 'empty-body').tier).toBe('critical')
      expect(strict.verdict).toBe('fail')
    } finally {
      await fixture.dispose()
    }
  })

  it('names the concept the library keeps citing without having a card for it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ip-wiki-wanted-'))
    try {
      await mkdir(join(root, 'cards', 'rule'), { recursive: true })
      await mkdir(join(root, 'index'), { recursive: true })
      // The library does have a card for 专利法第22条第2款, and does not have one for
      // 专利法第26条第3款 — both are cited by every card below.
      await writeFile(join(root, 'cards', 'rule', 'answered.md'), cardText([
        'id: "answered"',
        'type: "rule"',
        'title: "专利法第22条第2款"',
        'domain_l2: "OA 答复"',
        'concept: "法条"',
        'confidence: 0.9',
      ]))
      for (let index = 1; index <= 10; index += 1) {
        await writeFile(join(root, 'cards', 'rule', `c-${String(index)}.md`), cardText([
          `id: "c-${String(index)}"`,
          'type: "rule"',
          `title: "引用卡 ${String(index)}"`,
          'domain_l2: "OA 答复"',
          'concept: "引用"',
          'confidence: 0.9',
          'related_concepts:',
          '  - "answered"',
          'wiki_links:',
          '  - "专利法第22条第2款"',
          '  - "专利法第26条第3款"',
        ]))
      }
      await writeFile(join(root, 'index', 'card-index.json'),
        JSON.stringify({ schema_version: 1, total_cards: 11 }))

      const report = await readLintReport(root, 'warning')
      // Only the target no card answers: the one a card does answer has to leave the
      // report, or this rule would never clear and would be noise nobody can act on.
      expect(report.findings).toEqual([{
        tier: 'suggestion',
        code: 'wanted-card',
        message: '10 张卡提到、但库里没有对应的卡：专利法第26条第3款',
        path: '',
      }])
      expect(report.verdict).toBe('pass')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('names a business domain nothing links in or out of', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ip-wiki-island-'))
    try {
      await mkdir(join(root, 'cards', 'rule'), { recursive: true })
      await mkdir(join(root, 'index'), { recursive: true })
      // Five cards of one domain, linked only to each other, and two of another — so the
      // first domain is reachable from nowhere while the second is merely small.
      for (let index = 1; index <= 5; index += 1) {
        await writeFile(join(root, 'cards', 'rule', `island-${String(index)}.md`), cardText([
          `id: "island-${String(index)}"`,
          'type: "rule"',
          `title: "商标卡 ${String(index)}"`,
          'domain_l2: "商标"',
          'concept: "商标"',
          'confidence: 0.9',
          'related_concepts:',
          `  - "island-${String(index === 1 ? 2 : 1)}"`,
        ]))
      }
      for (const [index, peer] of [[1, 2], [2, 1]] as const) {
        await writeFile(join(root, 'cards', 'rule', `main-${String(index)}.md`), cardText([
          `id: "main-${String(index)}"`,
          'type: "rule"',
          `title: "审查卡 ${String(index)}"`,
          'domain_l2: "专利审查"',
          'concept: "审查"',
          'confidence: 0.9',
          'related_concepts:',
          `  - "main-${String(peer)}"`,
        ]))
      }
      await writeFile(join(root, 'index', 'card-index.json'),
        JSON.stringify({ schema_version: 1, total_cards: 7 }))

      const report = await readLintReport(root, 'warning')
      expect(report.findings).toEqual([{
        tier: 'suggestion',
        code: 'island-domain',
        message: '5 张卡的域与其它域没有任何互链（domain_l2）：商标',
        path: '',
      }])
      expect(report.verdict).toBe('pass')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('passes a clean library, so the gate is not simply always red', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-ip-wiki-clean-'))
    try {
      await mkdir(join(root, 'cards', 'rule'), { recursive: true })
      await mkdir(join(root, 'index'), { recursive: true })
      await writeFile(join(root, 'cards', 'rule', 'a.md'), cardText([
        'id: "a"',
        'type: "rule"',
        'title: "甲"',
        'domain_l2: "OA 答复"',
        'concept: "甲概念"',
        'related_concepts:',
        '  - "b"',
        'confidence: 0.9',
      ]))
      await writeFile(join(root, 'cards', 'rule', 'b.md'), cardText([
        'id: "b"',
        'type: "rule"',
        'title: "乙"',
        'domain_l2: "OA 答复"',
        'concept: "乙概念"',
        'confidence: 0.9',
      ]))
      await writeFile(join(root, 'index', 'card-index.json'),
        JSON.stringify({ schema_version: 1, total_cards: 2 }))
      const report = await readLintReport(root, 'warning')
      expect(report.findings).toEqual([])
      expect(report.verdict).toBe('pass')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
