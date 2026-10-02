/**
 * Negative control for the typecheck gate.
 *
 * The five strict switches are what make the source's optional values visible;
 * a spec that silently dropped one would leave the gate green and the code
 * unguarded, so the flags are asserted rather than assumed.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** The compiler options this gate requires to be on. */
const REQUIRED_FLAGS = [
  'strict',
  'noImplicitOverride',
  'noUncheckedIndexedAccess',
  'exactOptionalPropertyTypes',
  'noFallthroughCasesInSwitch',
] as const

/** The include patterns the gate requires. */
const REQUIRED_INCLUDE = [
  'src/**/*.ts',
  'src/**/*.tsx',
  'tests/**/*.ts',
  'tests/**/*.tsx',
] as const

/** The project's tsconfig, as written. */
const tsconfig = JSON.parse(readFileSync(join(process.cwd(), 'tsconfig.json'), 'utf8')) as {
  compilerOptions: Record<string, unknown>
  include: string[]
}

describe('the typecheck gate', () => {
  for (const flag of REQUIRED_FLAGS) {
    it(`keeps ${flag} on`, () => {
      expect(tsconfig.compilerOptions[flag]).toBe(true)
    })
  }

  it('checks the sources and the specs', () => {
    for (const pattern of REQUIRED_INCLUDE) expect(tsconfig.include).toContain(pattern)
  })
})
