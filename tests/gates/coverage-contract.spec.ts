/**
 * Negative control for the coverage gate.
 *
 * The threshold is only a gate while it stays at every file and every metric:
 * a narrowed `include` or a lowered number turns it into decoration, so the spec
 * asserts the configuration and the command that runs it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Project root the gate runs from. */
const root = process.cwd()

/** The vitest configuration, as written. */
const vitest = readFileSync(join(root, 'vitest.config.ts'), 'utf8')

/** The package manifest, as written. */
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}

describe('the coverage gate', () => {
  it('applies the thresholds to every file', () => {
    expect(vitest).toMatch(/perFile:\s*true/u)
  })

  for (const metric of ['lines', 'statements', 'branches', 'functions']) {
    it(`requires every ${metric}`, () => {
      expect(vitest).toMatch(new RegExp(`${metric}:\\s*100`, 'u'))
    })
  }

  it('covers every source file and nothing else', () => {
    expect(vitest).toMatch(/include:\s*\['src\/\*\*\/\*\.ts', 'src\/\*\*\/\*\.tsx'\]/u)
  })

  it('runs the three gates from one command', () => {
    expect(manifest.scripts['check']).toBe('pnpm run typecheck && pnpm run lint && pnpm run test:coverage')
  })
})
