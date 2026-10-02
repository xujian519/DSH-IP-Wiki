/**
 * Merge a library's duplicate cards into one live card per group.
 *
 * One-off maintenance tool, run with a TypeScript runner from this package:
 *
 * ```sh
 * tsx scripts/merge-duplicates.ts --root /path/to/library --dry   # print the plan
 * tsx scripts/merge-duplicates.ts --root /path/to/library         # write merge drafts
 * tsx scripts/merge-duplicates.ts --root /path --groups g.json    # use an explicit group list
 * ```
 *
 * Without `--groups` the groups are the cards whose titles are the same once
 * punctuation and case are gone — what the quality gate's `duplicate-title` rule
 * reports. With `--groups` they come from a list of `{"groups": [{"title",
 * "paths"}]}` instead, which is how a similarity instrument hands over the
 * duplicates a title comparison cannot see (the library's `tools/near_duplicates.py`
 * writes `reports/near-duplicates.json`, and a group list is built from it).
 * Either way a group is a set of paths that must all name live cards.
 *
 * It never writes a card. Every group becomes a merge draft that the user confirms
 * in the panel (or with `ip_wiki_review action="confirm"`); that same confirm marks
 * the absorbed cards `deprecated` and writes `superseded_by` on them, and reverting
 * the draft restores every byte.
 *
 * The merged card is assembled, not rewritten: the survivor's frontmatter is the
 * base card's frontmatter with the merge fields added, its body is the base card's
 * body plus a table of the absorbed cards, and the base card is the highest-quality
 * member of the group. No text is authored here and no text is dropped — the
 * absorbed cards keep their bodies in the library as history.
 * @module dsh-ip-wiki/scripts/merge-duplicates
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CardDocument } from '../src/shared/card'
import { parseFrontmatter } from '../src/shared/frontmatter'
import { duplicateGroups, type DuplicateGroup } from '../src/host/lint'
import { listCardDocuments } from '../src/host/library'
import { listDrafts, writeDraft, type CardDraft } from '../src/host/drafts'

/** Where the merge drafts record that the request came from. */
const SOURCE_REF = 'library:merge-duplicates'

/** The library to merge, unless `--root` names another one. */
const DEFAULT_ROOT = '/Users/xujian/projects/LLM-wiki-card'

/** Read one flag's value, or `undefined`. */
function flagOf(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  const value = at < 0 ? undefined : process.argv[at + 1]
  return value === undefined || value.startsWith('--') ? undefined : value
}

/**
 * Read one group list: `{"groups": [{"title": string, "paths": string[]}]}`.
 * @param file - the JSON file to read.
 * @returns the groups, in the order the file lists them.
 * @throws {Error} when the file is not that JSON, or a group names no path.
 */
async function groupListOf(file: string): Promise<DuplicateGroup[]> {
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`dsh-ip-wiki: ${file} must hold {"groups": [{"title", "paths"}]}`)
  }
  const listed = (parsed as Record<string, unknown>)['groups']
  if (!Array.isArray(listed)) {
    throw new Error(`dsh-ip-wiki: ${file} carries no "groups" array`)
  }
  return listed.map(entry => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`dsh-ip-wiki: every group in ${file} must be an object`)
    }
    const group = entry as Record<string, unknown>
    const paths = group['paths']
    if (typeof group['title'] !== 'string' || !Array.isArray(paths) || paths.length < 2
      || !paths.every(path => typeof path === 'string')) {
      throw new Error(`dsh-ip-wiki: a group in ${file} needs a "title" and at least two "paths"`)
    }
    return { title: group['title'], paths: paths as string[] }
  })
}

/** The card a group's merged card is built from: best quality, then a classified domain, then longest body, then path. */
function baseOf(members: readonly CardDocument[]): CardDocument {
  const unclassified = (card: CardDocument): number => (card.domainL2 === '' || card.domainL2 === '未分类' ? 1 : 0)
  const ranked = [...members].sort((left, right) =>
    (right.quality ?? -1) - (left.quality ?? -1)
    || unclassified(left) - unclassified(right)
    || right.body.length - left.body.length
    || left.path.localeCompare(right.path))
  const base = ranked[0]
  if (base === undefined) throw new Error('a duplicate group must have members')
  return base
}

/** A file name fragment for one merged card, taken from the base card's concept or title. */
function slugOf(base: CardDocument): string {
  const source = base.concept === '' ? base.title : base.concept
  const slug = source.replace(/[\\/:*?"<>|\s]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 40)
  return slug === '' ? 'group' : slug
}

/** The id a merged card carries: stable for the group it absorbs. */
function mergedIdOf(base: CardDocument, members: readonly CardDocument[]): string {
  const digest = createHash('sha256').update(members.map(member => member.id).sort().join(',')).digest('hex').slice(0, 8)
  return `merged-${slugOf(base)}-${digest}`
}

/**
 * Every line of a document's frontmatter block, without the delimiters.
 * @param source - the whole document.
 * @returns the block's lines.
 * @throws {Error} when the document carries no frontmatter block.
 */
function frontmatterLines(source: string): string[] {
  const lines = source.split('\n')
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (lines[0]?.trim() !== '---' || closing < 0) {
    throw new Error('dsh-ip-wiki: a card to merge must carry a frontmatter block')
  }
  return lines.slice(1, closing)
}

/** Whether one frontmatter line opens a top-level field, and which. */
function fieldOf(line: string): string | undefined {
  if (line.startsWith(' ') || line.startsWith('-')) return undefined
  const colon = line.indexOf(':')
  if (colon < 0) return undefined
  return line.slice(0, colon)
}

/**
 * Assemble one group's merged card: the base card's frontmatter with the merge
 * fields, and its body with a table naming the cards the merge absorbs.
 * @param base - the card the merged card is built from.
 * @param members - every card in the group, base included.
 * @param source - the base card's raw text.
 * @param now - the merge timestamp.
 * @returns the whole merged card text.
 */
function mergedText(base: CardDocument, members: readonly CardDocument[], source: string, now: string): string {
  // Every member is absorbed, the base included: its text is the merged card's
  // body, so leaving it live would keep the duplicate the merge is here to remove.
  const supersedes = members.map(member => member.id)
  const fields = frontmatterLines(source).map(line => fieldOf(line))
  // The merge fields are appended, so the base's own `supersedes` line goes: leaving
  // it in would put two `supersedes` keys in one block.
  const drop = new Set(['supersedes'])
  // A scalar the merged card owns is rewritten in place when the base already has it.
  const replaced = new Map<string, string>([
    ['id', `id: "${mergedIdOf(base, members)}"`],
    ['status', 'status: "confirmed"'],
    ['updated_at', `updated_at: "${now}"`],
    ['version', 'version: 2'],
  ])
  for (const name of ['updated_at', 'version']) {
    if (!fields.includes(name)) {
      replaced.delete(name)
      drop.add(name)
    }
  }
  const appended: string[] = []
  if (!fields.includes('updated_at')) appended.push(`updated_at: "${now}"`)
  if (!fields.includes('version')) appended.push('version: 2')
  const lines: string[] = []
  let skipping = false
  for (const line of frontmatterLines(source)) {
    const field = fieldOf(line)
    if (field === undefined) {
      // An indented line belongs to the field above it, so a dropped or replaced
      // field takes its own nested lines with it.
      if (!skipping) lines.push(line)
      continue
    }
    if (drop.has(field)) {
      skipping = true
      continue
    }
    const replacement = replaced.get(field)
    skipping = replacement !== undefined
    lines.push(replacement ?? line)
  }
  const list = (name: string, values: readonly string[]): string[] =>
    [`${name}:`, ...values.map(value => `  - "${value}"`)]
  const table = [
    '| 原卡 | 质量 | 业务域 | 处置 |',
    '| --- | --- | --- | --- |',
    ...members.map(member =>
      `| ${member.path} | ${member.quality === undefined ? '—' : member.quality.toFixed(2)} | ${member.domainL2} | `
      + `${member.id === base.id ? '本卡正文来源，同样 deprecated（原文保留）' : 'deprecated（原文保留）'} |`),
  ]
  return [
    '---',
    ...lines,
    ...appended,
    ...list('supersedes', supersedes),
    ...list('merged_from', members.map(member => member.path)),
    `merged_at: "${now}"`,
    `merge_note: "由 ${String(members.length)} 张重复卡合并：正文取质量分最高的一版，其余标 deprecated，可用 ip_wiki_review action=\\"revert\\" 回滚。"`,
    '---',
    '',
    parseFrontmatter(source).body.replace(/^\n+/u, ''),
    '## 合并说明',
    '',
    `本卡由 ${String(members.length)} 张重复卡合并而来（${now.slice(0, 10)}）：正文取质量分最高的一版，`
      + '其余版本标为 `deprecated`，原文仍留在库内（「已被取代」可跳转查看）。',
    '',
    ...table,
    '',
  ].join('\n')
}

const root = flagOf('root') ?? DEFAULT_ROOT
const dryRun = process.argv.includes('--dry')
const groupsFile = flagOf('groups')
const cards = await listCardDocuments(root)
const live = cards.filter(card => card.status !== 'deprecated')
const groups = groupsFile === undefined ? duplicateGroups(live) : await groupListOf(groupsFile)
console.log(`库 ${root}：${String(cards.length)} 张卡（在用 ${String(live.length)}），`
  + `${groupsFile === undefined ? '逐字同题' : `分组表 ${groupsFile}`} ${String(groups.length)} 组`)

const drafts: CardDraft[] = []
for (const group of groups) {
  const members = group.paths.map(path => {
    const found = live.find(card => card.path === path)
    if (found === undefined) throw new Error(`dsh-ip-wiki: no live card at ${path}`)
    return found
  })
  const base = baseOf(members)
  const target = `cards/${base.type}/merged-${slugOf(base)}-${createHash('sha256').update(members.map(member => member.id).sort().join(',')).digest('hex').slice(0, 8)}.md`
  const source = await readFile(join(root, base.path), 'utf8')
  const now = new Date().toISOString()
  const content = mergedText(base, members, source, now)
  console.log([
    '',
    `组：${group.title}`,
    `  合并卡：${target}`,
    `  正文来源：${base.path}（quality ${base.quality === undefined ? '—' : base.quality.toFixed(2)}，${String(base.body.length)} 字符）`,
    ...members.map(member => `  弃用：${member.path}（${member.id === base.id ? '正文来源' : '其余版本'}）`),
    `  合并卡长度：${String(content.length)} 字符（正文 ${String(content.length - content.indexOf('\n---', 4))} 字符）`,
  ].join('\n'))
  if (!dryRun) {
    drafts.push(await writeDraft(root, {
      path: target,
      content,
      classification: 'public',
      generatedBy: 'human',
      sourceRef: SOURCE_REF,
      note: `合并 ${String(members.length)} 张重复卡：正文取质量分最高的一版（${base.path}），其余标 deprecated。`,
      supersedes: group.paths,
    }, undefined))
  }
}
console.log(`\n${dryRun ? '（dry-run，未写任何草稿）' : `已提交合并草稿 ${String(drafts.length)} 份：${drafts.map(draft => draft.id).join(', ')}`}`)
console.log(`当前待确认草稿：${String((await listDrafts(root)).length)} 份`)
