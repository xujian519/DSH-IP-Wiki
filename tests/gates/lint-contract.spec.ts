/**
 * Negative control for the lint gate.
 *
 * A gate that cannot fail reads like protection while catching nothing, so this
 * spec runs the project's own configuration over three deliberately bad files and
 * requires a non-zero exit naming each rule.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Project root the gate runs from. */
const root = process.cwd()

/** The oxlint executable the gate script uses. */
const bin = join(root, 'node_modules', '.bin', 'oxlint')

/** One fixture and the rule it must trip. */
const CASES: readonly (readonly [string, string])[] = [
  ['tests/gates/fixtures/any.ts', 'no-explicit-any'],
  ['tests/gates/fixtures/assertions.ts', 'no-non-null-assertion'],
  ['tests/gates/fixtures/floating-promise.ts', 'no-floating-promises'],
]

/**
 * Run oxlint over one path.
 * @param args - the arguments after the executable.
 * @returns the exit code and the combined output.
 */
function lint(args: readonly string[]): { status: number; output: string } {
  // oxlint's launcher is a shell script, so the child needs node on its PATH.
  const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env['PATH'] ?? ''}` }
  try {
    return { status: 0, output: execFileSync(bin, [...args], { cwd: root, env, encoding: 'utf8' }) }
  } catch (cause) {
    const failure = cause as { status?: number; stdout?: string; stderr?: string }
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

describe('the lint gate', () => {
  it('keeps the three probe rules at error', () => {
    const config = JSON.parse(readFileSync(join(root, '.oxlintrc.json'), 'utf8')) as {
      rules: Record<string, unknown>
    }
    for (const [, rule] of CASES) expect(config.rules[rule], rule).toBe('error')
  })

  for (const [file, rule] of CASES) {
    it(`fails ${file} with ${rule}`, () => {
      const result = lint(['--type-aware', '--deny-warnings', file])
      expect(result.status).not.toBe(0)
      expect(result.output).toContain(rule)
    })
  }

  it('passes the same run over the sources', () => {
    const result = lint(['--type-aware', '--deny-warnings', 'src'])
    expect(result.output).toContain('Found 0 warnings and 0 errors')
  })
})
