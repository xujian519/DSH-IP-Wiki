/**
 * Negative control for the note format gate.
 *
 * A decision record's value is its shape: the state it claims, the four sections
 * that make it readable, and the alternatives it had to beat. Losing any one of
 * them is invisible in review, so the checker runs over fixtures that break each
 * rule in turn and must name all of them.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkNotes, collectDocs } from './docs'

/** Project root the gate runs from. */
const root = process.cwd()

/** The fixture tree, which the gate over the repository must never reach. */
const FIXTURES = 'tests/gates/fixtures/docs/notes'

/** The notes the repository's own gate owns. */
const NOTES = 'docs/notes'

/** Present problems the way a failing gate would, so a green run reads as empty. */
async function problemsIn(starts: readonly string[], notesDir: string): Promise<string> {
  const files = await collectDocs(root, starts)
  const problems = await checkNotes(root, files, notesDir)
  return problems.map(problem => `${problem.path}: ${problem.message}`).join('\n')
}

describe('the note format gate', () => {
  it('names every malformed note in the fixture', async () => {
    expect(await problemsIn([FIXTURES], FIXTURES)).toBe([
      `${FIXTURES}/archive/2026-09-30-stray.md: 决策记录必须放在 ${FIXTURES}/{proposed|implemented|rejected}/ 下`,
      `${FIXTURES}/implemented/2026-09-30-no-alternatives.md: ## Alternatives considered 至少要列一条备选`,
      `${FIXTURES}/implemented/2026-09-30-unordered.md: ## Alternatives considered 的位置不对`,
      `${FIXTURES}/implemented/not-a-date.md: 文件名必须是 yyyy-mm-dd-<短题>.md（短题用小写字母、数字与连字符）`,
      `${FIXTURES}/proposed/2026-09-30-wrong-status.md: Status: implemented 与所在目录 proposed 不一致`,
    ].join('\n'))
  })

  it('passes a note that follows the format', async () => {
    expect(await problemsIn([`${FIXTURES}/implemented/2026-09-30-good.md`], FIXTURES)).toBe('')
  })

  it('finds no malformed note in the repository', async () => {
    expect(await problemsIn([NOTES], NOTES)).toBe('')
  })

  it('runs from the check command', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(manifest.scripts['verify:docs']).toContain('tests/gates/notes.spec.ts')
  })
})
