/**
 * The two documentation gates.
 *
 * A doc set that only humans read drifts: a moved file leaves a dead link, and a
 * note that skips its alternatives section loses the one thing it exists to keep.
 * These are the single implementations both gates and their negative controls run,
 * so the fixtures prove the same code that judges the real tree.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

/** One finding: the file it is about, and what is wrong with it. */
export interface DocProblem {
  readonly path: string
  readonly message: string
}

/** The decision-record states, which are also their folder names. */
const STATUSES = ['proposed', 'implemented', 'rejected'] as const

/** The four sections every note carries, in this order. */
const NOTE_SECTIONS = ['## Problem', '## Decision', '## Alternatives considered', '## Consequences'] as const

/** Inline links and images, with an optional title. */
const LINK = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu

/** Fenced blocks: the fence line, its body, and the closing fence. */
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]{0,3}\1[^\n]*$/gmu

/** A code span, which may not cross a line. */
const CODE_SPAN = /`[^`\n]*`/gu

/** An ATX heading, with its trailing hashes. */
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/u

/**
 * Drop fenced blocks.
 * @param markdown - the file's text.
 * @returns the text without its fenced blocks.
 */
function stripFences(markdown: string): string {
  return markdown.replace(FENCE, '')
}

/**
 * Drop fenced blocks and inline code spans.
 * @param markdown - the file's text.
 * @returns the text without its code.
 */
function stripCode(markdown: string): string {
  return stripFences(markdown).replace(CODE_SPAN, '')
}

/**
 * The anchor a heading gets, following GitHub's slug rules as closely as the
 * repository needs: lower case, punctuation dropped, spaces to hyphens.
 * @param heading - the heading's text.
 * @returns the anchor id.
 */
export function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\p{Pc} -]/gu, '')
    .replace(/ /gu, '-')
}

/**
 * The anchors one Markdown file offers, including GitHub's duplicate suffixes.
 * @param markdown - the file's text.
 * @returns the set of anchor ids.
 */
export function anchorsIn(markdown: string): Set<string> {
  const anchors = new Set<string>()
  const seen = new Map<string, number>()
  for (const line of stripFences(markdown).split('\n')) {
    const heading = HEADING.exec(line)
    if (heading === null) continue
    const base = slugify(heading[2] ?? '')
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    anchors.add(count === 0 ? base : `${base}-${count}`)
  }
  return anchors
}

/**
 * List the documentation files under the given starts.
 * @param root - the repository root the returned paths are relative to.
 * @param starts - files or directories to include, relative to the root.
 * @returns the matching file paths, sorted.
 */
export async function collectDocs(root: string, starts: readonly string[]): Promise<string[]> {
  const files: string[] = []
  for (const start of starts) {
    const absolute = resolve(root, start)
    const info = await stat(absolute)
    if (!info.isDirectory()) {
      files.push(start)
      continue
    }
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.name.endsWith('.md')) continue
      const child = join(start, entry.name)
      if (entry.isDirectory()) files.push(...(await collectDocs(root, [child])))
      else files.push(child)
    }
  }
  return files.sort()
}

/** Whether a path stays inside the root it is resolved against. */
function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Whether the path exists; only a missing path is a `false`, other errors escape. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

/** A link's target, split at its anchor. */
function splitTarget(target: string): { path: string; anchor: string | null } {
  const hash = target.indexOf('#')
  if (hash === -1) return { path: target, anchor: null }
  return { path: target.slice(0, hash), anchor: target.slice(hash + 1) }
}

/**
 * Check one link target.
 * @param root - the repository root.
 * @param from - the linking file, relative to the root.
 * @param target - the link's raw target text.
 * @returns the problems this target has, if any.
 */
async function checkTarget(root: string, from: string, target: string): Promise<DocProblem[]> {
  const problem = (message: string): DocProblem[] => [{ path: from, message: `${message}（${target}）` }]
  if (target === '' || /^[a-z][a-z0-9+.-]*:/iu.test(target) || target.startsWith('//')) return []
  const { path, anchor } = splitTarget(target)
  const resolved = path === '' ? resolve(root, from) : resolve(root, dirname(from), path)
  if (!isInside(root, resolved)) return problem('指向仓库之外的链接')
  if (!(await exists(resolved))) return problem('链接目标不存在')
  if (anchor === null) return []
  if (!resolved.endsWith('.md')) return []
  const anchors = anchorsIn(await readFile(resolved, 'utf8'))
  const raw = anchors.has(anchor)
  const decoded = anchors.has(decodeAnchor(anchor))
  return raw || decoded ? [] : problem('目标文件里没有这个标题锚点')
}

/**
 * Decode a percent-encoded anchor, leaving a malformed one as written.
 * @param anchor - the anchor text from the link.
 * @returns the decoded anchor.
 */
function decodeAnchor(anchor: string): string {
  try {
    return decodeURIComponent(anchor)
  } catch (error) {
    if (error instanceof URIError) return anchor
    throw error
  }
}

/**
 * Every link in the given files must point at a file that exists, and at a
 * heading that exists when it names one.
 * @param root - the repository root.
 * @param files - the documentation files, relative to the root.
 * @returns one problem per broken link, empty when the docs are clean.
 */
export async function checkDocLinks(root: string, files: readonly string[]): Promise<DocProblem[]> {
  const problems: DocProblem[] = []
  for (const file of files) {
    const text = stripCode(await readFile(join(root, file), 'utf8'))
    for (const [, target] of text.matchAll(LINK)) {
      if (target === undefined) continue
      problems.push(...(await checkTarget(root, file, target.trim())))
    }
  }
  return problems
}

/** Whether one note file lives at a legal path. */
function checkNotePath(file: string, notesDir: string): DocProblem[] {
  const folder = STATUSES.find(status => file.startsWith(`${notesDir}/${status}/`))
  const name = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$/u
  const leaf = file.slice(file.lastIndexOf('/') + 1)
  if (folder === undefined) {
    return [{ path: file, message: `决策记录必须放在 ${notesDir}/{${STATUSES.join('|')}}/ 下` }]
  }
  if (!name.test(leaf)) {
    return [{ path: file, message: '文件名必须是 yyyy-mm-dd-<短题>.md（短题用小写字母、数字与连字符）' }]
  }
  return []
}

/**
 * Check one note's header block and section skeleton.
 * @param file - the note's path, relative to the root.
 * @param text - the note's text.
 * @param status - the folder the note sits in.
 * @returns the problems this note has, if any.
 */
function checkNoteBody(file: string, text: string, status: string): DocProblem[] {
  const problems: DocProblem[] = []
  const lines = text.split('\n')
  if (!/^# Note: \S/u.test(lines[0] ?? '')) problems.push({ path: file, message: '首行必须是 `# Note: <标题>`' })
  if ((lines[1] ?? '').trim() !== '') problems.push({ path: file, message: '标题后必须空一行再写 Status' })
  const declared = /^Status: (\S+)$/u.exec(lines[2] ?? '')?.[1]
  if (declared === undefined) {
    problems.push({ path: file, message: '第三行必须是 `Status: <状态>`' })
  } else if (declared !== status) {
    problems.push({ path: file, message: `Status: ${declared} 与所在目录 ${status} 不一致` })
  }

  const bodyLines = stripFences(text).split('\n')
  const headings = bodyLines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(item => /^## /u.test(item.line))
  if (headings[0]?.line !== NOTE_SECTIONS[0]) {
    problems.push({ path: file, message: `正文第一个二级标题必须是 ${NOTE_SECTIONS[0]}` })
  }
  let cursor = -1
  for (const section of NOTE_SECTIONS) {
    const found = headings.find(item => item.line === section)
    if (found === undefined) {
      problems.push({ path: file, message: `缺 ${section}` })
      continue
    }
    if (found.index < cursor) problems.push({ path: file, message: `${section} 的位置不对` })
    cursor = found.index
  }

  const alternatives = headings.find(item => item.line === NOTE_SECTIONS[2])
  if (alternatives !== undefined) {
    const next = headings.find(item => item.index > alternatives.index)
    const section = bodyLines.slice(alternatives.index, next?.index ?? bodyLines.length).join('\n')
    if (!/^[ \t]*[-*+] /mu.test(section)) {
      problems.push({ path: file, message: '## Alternatives considered 至少要列一条备选' })
    }
  }
  return problems
}

/**
 * Every decision record must sit in a legal status folder, declare that status,
 * and carry the four-section skeleton with a non-empty alternatives list.
 * @param root - the repository root.
 * @param files - the documentation files, relative to the root.
 * @param notesDir - the notes directory prefix, relative to the root.
 * @returns one problem per violation, empty when the notes are clean.
 */
export async function checkNotes(
  root: string,
  files: readonly string[],
  notesDir = 'docs/notes',
): Promise<DocProblem[]> {
  const problems: DocProblem[] = []
  for (const file of files) {
    if (!file.startsWith(`${notesDir}/`)) continue
    const within = file.slice(notesDir.length + 1)
    // `docs/notes/README.md` and deeper paths are not decision records.
    if (within.split('/').length !== 2) continue
    const pathProblems = checkNotePath(file, notesDir)
    if (pathProblems.length > 0) {
      problems.push(...pathProblems)
      continue
    }
    const status = STATUSES.find(candidate => file.startsWith(`${notesDir}/${candidate}/`))
    if (status === undefined) continue
    problems.push(...checkNoteBody(file, await readFile(join(root, file), 'utf8'), status))
  }
  return problems
}
