/**
 * Negative control for the local/CI pipeline.
 *
 * The five gates are only as good as what runs them. A workflow that stopped
 * calling `pnpm run check`, or a hook that stopped linting the staged files,
 * would leave every other spec green while the checks silently stopped running
 * — the failure mode this file exists to make visible. So the same checker that
 * reads the real `lefthook.yml` and workflow is run over mutated copies, and
 * each defect must come back named.
 *
 * Every check reads declarations, never prose: the configs mention the commands
 * they run in their own comments, and a checker satisfied by a comment would go
 * green on exactly the regression it is meant to catch.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Project root the gate runs from. */
const root = process.cwd()

/** The CI workflow that runs the five gates on push and pull requests. */
const WORKFLOW = '.github/workflows/check.yml'

/** The local hook configuration. */
const HOOKS = 'lefthook.yml'

/** The package manifest's fields this gate reads. */
interface Manifest {
  readonly scripts: Record<string, string>
  readonly packageManager?: string
  readonly engines?: { readonly node?: string }
}

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest

/** The node versions the package claims to support. */
const engines = manifest.engines?.node ?? ''

/**
 * Drop full-line YAML and shell comments.
 * @param text - the file's text.
 * @returns the text without its comment lines.
 */
function withoutComments(text: string): string {
  return text
    .split('\n')
    .filter(line => !/^\s*#/u.test(line))
    .join('\n')
}

/**
 * One top-level YAML section, stopping at the next column-zero key.
 * @param text - the already comment-free YAML document.
 * @param name - the top-level key.
 * @returns the section's lines, empty when the key is absent.
 */
function section(text: string, name: string): string {
  const lines = text.split('\n')
  const start = lines.findIndex(line => line.startsWith(`${name}:`))
  if (start === -1) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => /^\S/.test(line))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/**
 * The lines declaring one step property, such as `run` or `uses`.
 * @param text - the already comment-free workflow.
 * @param key - the property name.
 * @returns the matching lines, joined.
 */
function declarations(text: string, key: string): string {
  const pattern = new RegExp(`^\\s*-?\\s*${key}:`, 'u')
  return text
    .split('\n')
    .filter(line => pattern.test(line))
    .join('\n')
}

/**
 * One list item of a workflow, stopping at the next item.
 * @param text - the already comment-free workflow.
 * @param marker - text identifying the item, such as an action name.
 * @returns the item's lines, empty when the marker is absent.
 */
function step(text: string, marker: string): string {
  const lines = text.split('\n')
  const start = lines.findIndex(line => line.includes(marker))
  if (start === -1) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => /^\s*-\s/u.test(line))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/**
 * What the workflow must keep doing.
 * @param raw - the workflow file.
 * @returns one message per missing or divergent piece, empty when it is sound.
 */
function workflowProblems(raw: string): string[] {
  const text = withoutComments(raw)
  const problems: string[] = []
  const triggers = section(text, 'on')
  if (!/^\s*push:/mu.test(triggers)) problems.push('workflow 不再在 push 上触发')
  if (!/^\s*pull_request:/mu.test(triggers)) problems.push('workflow 不再在 pull_request 上触发')

  const actions = declarations(text, 'uses')
  for (const action of ['actions/checkout', 'pnpm/action-setup', 'actions/setup-node']) {
    if (!actions.includes(action)) problems.push(`workflow 缺 ${action}`)
  }

  const commands = declarations(text, 'run')
  if (!commands.includes('pnpm install --frozen-lockfile')) problems.push('workflow 不再用 --frozen-lockfile 安装')
  if (!commands.includes('pnpm run check')) problems.push('workflow 不再跑 pnpm run check')

  // pnpm 的版本只有一个家：package.json 的 packageManager。在 action 上再写一遍
  // 会让两处可能不一致，而 pnpm/action-setup 遇到两处不一致会直接拒绝运行。
  if (/^\s*version:/mu.test(step(text, 'pnpm/action-setup'))) {
    problems.push('workflow 又固定了 pnpm 版本，与 package.json 的 packageManager 抢所有权')
  }

  const node = /node-version:\s*(\d+)/u.exec(step(text, 'actions/setup-node'))?.[1]
  if (node === undefined) problems.push('workflow 没写 node-version')
  else if (!engines.includes(node)) problems.push(`workflow 的 node ${node} 不在 engines（${engines}）范围内`)
  return problems
}

/**
 * What the hooks must keep doing, and what they must keep not doing.
 * @param raw - the hook configuration.
 * @returns one message per missing or divergent piece, empty when it is sound.
 */
function hooksProblems(raw: string): string[] {
  const text = withoutComments(raw)
  const problems: string[] = []
  const preCommit = section(text, 'pre-commit')
  if (!/oxlint/u.test(preCommit)) problems.push('pre-commit 不再跑 oxlint')
  if (!preCommit.includes('{staged_files}')) problems.push('pre-commit 不再只检查暂存文件')
  if (!preCommit.includes('--fix')) problems.push('pre-commit 不再自动修复')
  if (!preCommit.includes('git diff --cached --check')) problems.push('pre-commit 不再查空白')
  // type-aware 的 lint 要起 tsgolint 并载入整个 TS 程序，放进 pre-commit 就不再是
  // 秒级检查；类型感知的规则由 pre-push 的 typecheck 与 CI 的全量 lint 兜住。
  if (preCommit.includes('--type-aware')) problems.push('pre-commit 变成了全量 lint，不再是窄检查')

  if (!section(text, 'pre-push').includes('pnpm run typecheck')) problems.push('pre-push 不再跑 typecheck')
  return problems
}

describe('the local/CI pipeline', () => {
  const workflow = readFileSync(join(root, WORKFLOW), 'utf8')
  const hooks = readFileSync(join(root, HOOKS), 'utf8')

  it('runs the gates in CI from the same command as locally', () => {
    expect(workflowProblems(workflow)).toEqual([])
  })

  it('keeps the local hooks narrow', () => {
    expect(hooksProblems(hooks)).toEqual([])
  })

  it('installs the hooks on install, and pins pnpm in one place', () => {
    expect(manifest.scripts['prepare']).toBe('lefthook install')
    expect(manifest.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/u)
  })

  it('flags a workflow that stopped running the gates', () => {
    const mutated = workflow.replace('run: pnpm run check', 'run: echo skipped')
    expect(mutated).not.toBe(workflow)
    expect(workflowProblems(mutated)).toEqual(['workflow 不再跑 pnpm run check'])
  })

  it('flags a workflow that pins pnpm behind packageManager', () => {
    const mutated = workflow.replace(
      'uses: pnpm/action-setup@v4',
      'uses: pnpm/action-setup@v4\n        with:\n          version: 9',
    )
    expect(mutated).not.toBe(workflow)
    expect(workflowProblems(mutated)).toEqual([
      'workflow 又固定了 pnpm 版本，与 package.json 的 packageManager 抢所有权',
    ])
  })

  it('flags a workflow that stopped installing from the lockfile', () => {
    const mutated = workflow.replace('pnpm install --frozen-lockfile', 'pnpm install')
    expect(mutated).not.toBe(workflow)
    expect(workflowProblems(mutated)).toEqual(['workflow 不再用 --frozen-lockfile 安装'])
  })

  it('flags hooks that stopped checking the staged files', () => {
    const mutated = hooks.replace('{staged_files}', '')
    expect(mutated).not.toBe(hooks)
    expect(hooksProblems(mutated)).toEqual(['pre-commit 不再只检查暂存文件'])
  })

  it('flags hooks that dropped the type check', () => {
    const mutated = hooks.replace('pnpm run typecheck', 'true')
    expect(mutated).not.toBe(hooks)
    expect(hooksProblems(mutated)).toEqual(['pre-push 不再跑 typecheck'])
  })

  it('flags a pre-commit that grew into the full lint', () => {
    const mutated = hooks.replace('oxlint --fix', 'oxlint --type-aware --fix')
    expect(mutated).not.toBe(hooks)
    expect(hooksProblems(mutated)).toEqual(['pre-commit 变成了全量 lint，不再是窄检查'])
  })

  it('flags a pre-commit that stopped fixing and blocking', () => {
    const mutated = hooks.replace('--fix --deny-warnings', '--deny-warnings')
    expect(mutated).not.toBe(hooks)
    expect(hooksProblems(mutated)).toEqual(['pre-commit 不再自动修复'])
  })
})
