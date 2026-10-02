/**
 * Negative control for the doc link gate.
 *
 * Prose only drifts silently: a moved file leaves a link that reads fine and goes
 * nowhere, and nothing else in the suite notices. So the same checker that judges
 * `AGENTS.md` / `README.md` / `docs/**` is run over a fixture that is deliberately
 * broken, and each defect must come back named — a checker that accepted the
 * fixture would make the green run over the repository meaningless.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkDocLinks, collectDocs } from './docs'

/** Project root the gate runs from. */
const root = process.cwd()

/** The fixture tree, which the gate over the repository must never reach. */
const FIXTURES = 'tests/gates/fixtures/docs'

/** The files the repository's own docs gate owns. */
const DOC_STARTS = ['AGENTS.md', 'README.md', 'docs']

/** Present problems the way a failing gate would, so a green run reads as empty. */
async function problemsIn(starts: readonly string[]): Promise<string> {
  const files = await collectDocs(root, starts)
  const problems = await checkDocLinks(root, files)
  return problems.map(problem => `${problem.path}: ${problem.message}`).join('\n')
}

describe('the doc link gate', () => {
  it('names every broken link in the fixture', async () => {
    expect(await problemsIn([FIXTURES])).toBe([
      'tests/gates/fixtures/docs/links.md: 链接目标不存在（missing.md）',
      'tests/gates/fixtures/docs/links.md: 目标文件里没有这个标题锚点（target.md#不存在的标题）',
      'tests/gates/fixtures/docs/links.md: 指向仓库之外的链接（../../../../../outside.md）',
    ].join('\n'))
  })

  it('passes a file whose links are sound', async () => {
    expect(await problemsIn([`${FIXTURES}/sound.md`, `${FIXTURES}/target.md`])).toBe('')
  })

  it('finds no broken link in the repository docs', async () => {
    expect(await problemsIn(DOC_STARTS)).toBe('')
  })

  it('runs from the check command', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(manifest.scripts['verify:docs']).toContain('tests/gates/docs-links.spec.ts')
    // The gates are vitest specs, so the third gate is what actually runs them.
    expect(manifest.scripts['check']).toContain('test:coverage')
  })
})
