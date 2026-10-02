/**
 * Import the vault's compiled Wiki pages into the card library.
 *
 * The Wiki is the distilled layer of the vault: its pages already carry the
 * `标签 / 溯源 / 法律依据 / 技术领域` metadata and the prose, and the raw decisions
 * stay in the vault's `Raw/` tree. So this tool **assembles** a card from a page — it
 * never authors or rewrites prose, which is what keeps `ip_wiki_cite` able to verify a
 * quotation word by word.
 *
 * One-off maintenance tool, run with a TypeScript runner from this package:
 *
 * ```sh
 * tsx scripts/import-wiki.ts --root /path/to/library --dry          # the plan, and a report
 * tsx scripts/import-wiki.ts --root /path/to/library --batch 1      # write that batch's drafts
 * ```
 *
 * It never writes a card. Every page becomes a card draft that the user confirms in
 * the panel (or with `ip_wiki_review action="confirm"`), and reverting a draft restores
 * every byte it touched.
 *
 * Two properties the callers rely on:
 *
 * - **The same page always produces the same draft id.** Timestamps come from the
 *   source page's mtime and nothing else is derived from the clock, so re-running over
 *   an unchanged vault writes nothing new and duplicates no draft.
 * - **A page that carries no prose is not a card.** Index pages, book skeletons, and
 *   split-family shells measure below {@link CARD_PROSE} characters of prose and are
 *   skipped, with the count reported.
 * @module dsh-ip-wiki/scripts/import-wiki
 */
import { createHash } from 'node:crypto'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import type { CardDocument, CardType } from '../src/shared/card'
import { listDrafts, writeDraft, type CardDraft } from '../src/host/drafts'
import { listCardDocuments } from '../src/host/library'
import { normalizeTitle } from '../src/host/lint'

/** The library the cards land in, unless `--root` names another one. */
const DEFAULT_ROOT = '/Users/xujian/projects/LLM-wiki-card'

/** The vault's compiled Wiki, unless `--wiki` names another tree. */
const DEFAULT_WIKI = '/Users/xujian/Library/Mobile Documents/iCloud~md~obsidian/Documents/宝宸知识库/Wiki'

/** Where the import drafts record that the request came from. */
const SOURCE_REF = 'vault:wiki-import'

/** Least prose characters a page needs to become a card. */
const CARD_PROSE = 200

/** How many pages one batch drafts. The whole set is one landing by default. */
const DEFAULT_BATCH_SIZE = 1000

/** Pages that are navigation, an index, or a health report rather than knowledge. */
const NAVIGATION = /(^|\/)(index|log|CLAUDE|AGENTS|README)\.md$|All-Concepts|Concept-Hierarchy|Concept-Index|_orphan_analysis|调研报告|健康报告/iu

/** Heading lines that name a section instead of the page's subject. */
const GENERIC_HEADINGS = new Set([
  '决定要点', '裁判规则', '典型案例', '核心要点', '实务要点速查', '关联知识', '核心审查标准',
  '审查标准', '审查要点', '法条', '原理', '新颖性', '创造性', '说明书和权利要求书', '基本案情',
  '裁判要旨', '指导性案例', '拆分自', '目录', '相关法条', '关键要点', '要点',
])

/** Whether a heading names a section rather than the page, so the file name is a better title. */
function isGenericHeading(heading: string): boolean {
  const bare = heading.replace(/[（(]\s*\d+\s*[)）]/gu, '').replace(/[:：\s]+$/u, '').trim()
  return bare.length < 4 || GENERIC_HEADINGS.has(bare)
}

/** A file-name title with the copy markers a file manager adds removed. */
function stemTitle(stem: string): string {
  const stripped = stem.replace(/([（(]\s*\d+\s*[)）])+$/u, '').trim()
  return stripped === '' ? stem : stripped
}

/** Boilerplate blockquote labels that carry no prose. */
const METADATA_LINE = /^\s*>\s*(\*\*)?(标签|溯源|法律依据|技术领域|关联页面|拆分自|来源|ISBN|页数|丛书|特点|最新更新|总卡片数|本页|说明|目录)/u

/** The business domain a page belongs to, by `Wiki/<top>/<second>` path. */
const DOMAIN_BY_PATH: Readonly<Record<string, string>> = {
  '专利实务/说明书': '权利要求与说明书',
  '专利实务/权利要求': '权利要求与说明书',
  '专利实务/撰写': '权利要求与说明书',
  '专利实务/修改': '权利要求与说明书',
  '专利实务/权属': '权属问题',
  '专利实务/创造性': '专利授权',
  '专利实务/新颖性': '专利授权',
  '专利实务/实用性': '专利授权',
  '专利实务/不授予专利权的客体': '专利授权',
  '专利实务/现有技术和现有设计': '现有技术',
  '专利实务/外观设计': '外观设计',
  '专利实务/侵权': '专利侵权',
  '专利实务/等同侵权': '专利侵权',
  '专利实务/间接侵权': '专利侵权',
  '专利实务/侵权救济': '专利侵权',
  '专利实务/权能': '专利权效力',
  '专利实务/强制许可': '专利权效力',
  '专利实务/程序': '程序问题',
  '专利实务/专利程序': '程序问题',
  '专利实务/证据的认定': '程序问题',
  '专利实务/总则': '专利审查',
  '专利实务/专利法概述': '专利审查',
  '复审无效/创造性': '专利授权',
  '复审无效/新颖性': '专利授权',
  '复审无效/说明书': '权利要求与说明书',
  '复审无效/权利要求': '权利要求与说明书',
  '复审无效/外观设计': '外观设计',
  '复审无效/推理模式': '专利审查',
  '审查指南/第二部分-实质审查': '专利审查',
  '审查指南/第一部分-初步审查': '专利审查',
  '审查指南/第三部分-国际申请': '程序问题',
  '审查指南/第四部分-复审和无效': '专利无效',
  '专利侵权/权利保护范围': '权利要求解释',
  '专利侵权/侵权抗辩': '侵权抗辩',
  '专利侵权/侵权判定': '专利侵权',
  '专利侵权/其他侵权行为': '专利侵权',
  '专利侵权/外观设计侵权判定': '外观设计',
  '专利侵权/外观设计保护范围': '外观设计',
  '专利判决/侵权判定': '专利侵权',
  '专利判决/外观设计': '外观设计',
  '专利判决/程序与证据': '程序问题',
  '专利判决/权属纠纷': '权属问题',
  '法律法规/法律': '法律法规',
  '法律法规/司法解释': '法律法规',
  '法律法规/商标': '商标',
}

/** The domain a page falls back to when its subtree has no more specific entry. */
const DOMAIN_BY_TOP: Readonly<Record<string, string>> = {
  专利实务: '未分类',
  复审无效: '专利无效',
  审查指南: '专利审查',
  专利侵权: '专利侵权',
  专利判决: '专利侵权',
  法律法规: '法律法规',
  个人笔记: '未分类',
  书籍: '未分类',
  cards: '未分类',
}

/** One page of the Wiki, ready to become a card. */
interface WikiPage {
  /** Absolute path on disk. */
  readonly absolute: string
  /** Path relative to the Wiki root, with `/` separators. */
  readonly rel: string
  /** Path relative to the vault root, which is the concept index's own key. */
  readonly vaultRel: string
  /** Whole page text. */
  readonly text: string
  /** Prose characters, by {@link proseOf}. */
  readonly prose: number
  /** The page's `# ` heading, when it has one. */
  readonly heading: string
  /** Whether the title came from the heading rather than the file name. */
  readonly titled: boolean
  /** Card type this page maps to. */
  readonly type: CardType
  /** Card title. */
  readonly title: string
  /** Business domain. */
  readonly domainL2: string
  /** Concept label, from the vault's concept index when it has one. */
  readonly concept: string
  /** Legal references quoted on the page. */
  readonly lawRefs: readonly string[]
  /** `[[…]]` targets the page points at. */
  readonly links: readonly string[]
  /** Card ids the page's links resolve to; every one of them is imported too. */
  readonly related: readonly string[]
  /** Link targets that resolved to nothing, kept for the record. */
  readonly unresolved: readonly string[]
  /** Deterministic card id. */
  readonly id: string
  /** Where the card would land. */
  readonly target: string
  /** Deterministic quality score. */
  readonly quality: number
  /** Deterministic review confidence. */
  readonly confidence: number
  /** Source modification time, which every generated timestamp uses. */
  readonly mtime: string
}

/** Read one flag's value, or `undefined`. */
function flagOf(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  const value = at < 0 ? undefined : process.argv[at + 1]
  return value === undefined || value.startsWith('--') ? undefined : value
}

/** Read one numeric flag, or a default. */
function numberFlagOf(name: string, fallback: number): number {
  const raw = flagOf(name)
  if (raw === undefined) return fallback
  const value = Number.parseInt(raw, 10)
  if (Number.isNaN(value) || value < 1) throw new Error(`dsh-ip-wiki: --${name} must be a positive integer, got ${raw}`)
  return value
}

/** Every `.md` file under one directory, path-sorted for a deterministic run. */
async function markdownFiles(root: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && entry.name.endsWith('.md')) found.push(path)
    }
  }
  await walk(root)
  return found
}

/** Drop link and image markup, keeping the words a reader sees. */
function cleanMarkup(text: string): string {
  return text
    .replace(/\[\[([^\]|]*)\|?([^\]]*)\]\]/gu, (_whole, target: string, label: string) => label === '' ? target : label)
    .replace(/!?\[[^\]]*\]\([^)]*\)/gu, '')
    .trim()
}

/**
 * Count the prose a page carries.
 *
 * A Wiki page puts knowledge in three places, so all three count: ordinary lines,
 * blockquotes (a statute page carries the article text there), and long headings (a
 * personal note writes whole paragraphs as `###` lines). Blockquote and list lines
 * only count when what remains after the markup is long enough to be prose, which is
 * what keeps a metadata block or a link list from reading as content. A leading YAML
 * block is metadata, never prose: a frontmatter-only stub is a shell page.
 * @param text - the whole page.
 * @returns the number of prose characters.
 */
function proseOf(text: string): number {
  let total = 0
  let body = text
  if (body.startsWith('---\n')) {
    const closing = body.indexOf('\n---', 4)
    if (closing >= 0) body = body.slice(body.indexOf('\n', closing + 1) + 1)
  }
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('```') || trimmed.startsWith('---') || trimmed.startsWith('|')) continue
    if (METADATA_LINE.test(line)) continue
    const heading = /^#{1,6}\s*(.*)$/u.exec(trimmed)
    if (heading !== null) {
      const body = cleanMarkup(heading[1] ?? '')
      if (body.length >= 40) total += body.length
      continue
    }
    const quoted = /^[>*\-+]/u.test(trimmed)
    const body = cleanMarkup(trimmed.replace(/^[>*\-+]\s*/u, ''))
    if (quoted) {
      if (body.length >= 30) total += body.length
      continue
    }
    total += body.length
  }
  return total
}

/** The card type a page maps to, by subtree first and file name second. */
function typeOf(rel: string, name: string): CardType {
  const top = rel.split(sep)[0] ?? ''
  if (top === '法律法规') return 'statute'
  if (top === '专利判决') return 'case'
  if (top === '复审无效' || top === '审查指南') return 'rule'
  if (name.includes('法条')) return 'statute'
  if (/概念-|概述|是什么|的定义|定义与|基本概念/u.test(name)) return 'concept'
  if (/原理|标准|要点|规则|方法|判断|要件|流程|程序|指引|清单|审查/u.test(name)) return 'rule'
  return 'concept'
}

/** The business domain a page belongs to. */
function domainOf(rel: string): string {
  const parts = rel.split(sep)
  const top = parts[0] ?? ''
  const second = parts.length > 2 ? `${top}/${parts[1] ?? ''}` : top
  return DOMAIN_BY_PATH[second] ?? DOMAIN_BY_TOP[top] ?? '未分类'
}

/** The page's own heading, when it names the page rather than a section. */
function headingOf(text: string): string {
  for (const line of text.split('\n')) {
    if (line.startsWith('# ')) return line.slice(2).trim()
  }
  return ''
}

/** A file-name identity for one page: the name without directories or extension. */
function stemOf(rel: string): string {
  return basename(rel, '.md')
}

/** Legal references a page quotes, normalized the way the existing cards spell them. */
function lawRefsOf(text: string): string[] {
  const refs = new Set<string>()
  const pattern = /《([^》]{1,40})》\s*第\s*([一二三四五六七八九十百零〇0-9]{1,8})\s*条(?:\s*第\s*([一二三四五六七八九十0-9]{1,6})\s*款)?/gu
  for (const match of text.matchAll(pattern)) {
    const law = (match[1] ?? '').replace(/^中华人民共和国/u, '').trim()
    const article = match[2] ?? ''
    const clause = match[3]
    if (law === '' || article === '') continue
    refs.add(`${law}第${article}条${clause === undefined ? '' : `第${clause}款`}`)
    if (refs.size >= 8) break
  }
  return [...refs]
}

/** `[[…]]` targets a page points at, without anchors. */
function linksOf(text: string): string[] {
  const links = new Set<string>()
  for (const match of text.matchAll(/\[\[([^\]|#^]+)/gu)) {
    const target = cleanMarkup(match[1] ?? '').trim()
    if (target !== '') links.add(target)
    if (links.size >= 20) break
  }
  return [...links]
}

/** A path-safe slug for one card id. */
function slugOf(text: string): string {
  const slug = text.replace(/[\\/:*?"<>|\s]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 60)
  return slug === '' ? 'page' : slug
}

/** The id one page's card carries: stable for the page it came from. */
function idOf(rel: string): string {
  const digest = createHash('sha256').update(rel).digest('hex').slice(0, 8)
  return `wiki-${slugOf(stemOf(rel))}-${digest}`
}

/** Quality and confidence for one page, from what the page itself shows. */
function scoresOf(page: Omit<WikiPage, 'quality' | 'confidence'>): { readonly quality: number; readonly confidence: number } {
  const hasRelated = /关联页面|关联知识|相关页面|关联卡片/u.test(page.text)
  const quality = Math.min(1, 0.6
    + (page.prose >= 800 ? 0.1 : 0)
    + (page.prose >= 2500 ? 0.1 : 0)
    + (hasRelated ? 0.1 : 0)
    + (page.lawRefs.length > 0 ? 0.1 : 0))
  const confidence = page.titled && page.prose >= 400 && (hasRelated || page.lawRefs.length > 0)
    ? 0.9
    : (page.titled || page.prose >= 800 ? 0.6 : 0.35)
  return { quality: Math.round(quality * 100) / 100, confidence }
}

/** The whole card text for one page: assembled from the page, never rewritten. */
function cardText(page: WikiPage): string {
  const quote = page.titled ? page.heading : page.title
  return [
    '---',
    `id: "${page.id}"`,
    `type: "${page.type}"`,
    `title: ${JSON.stringify(page.title)}`,
    'domain_l1: "专利"',
    `domain_l2: ${JSON.stringify(page.domainL2)}`,
    `concept: ${JSON.stringify(page.concept)}`,
    page.related.length === 0 ? 'related_concepts: []' : ['related_concepts:', ...page.related.map(id => `  - ${JSON.stringify(id)}`)].join('\n'),
    page.lawRefs.length === 0 ? 'law_refs: []' : ['law_refs:', ...page.lawRefs.map(ref => `  - ${JSON.stringify(ref)}`)].join('\n'),
    'jurisdiction: "CN"',
    'source:',
    '  kind: "vault-wiki"',
    `  path: ${JSON.stringify(page.absolute)}`,
    `  quote: ${JSON.stringify(quote)}`,
    `  retrieved_at: "${page.mtime}"`,
    `quality: ${page.quality.toFixed(2)}`,
    `confidence: ${page.confidence.toFixed(2)}`,
    'status: "draft"',
    'version: 1',
    `created_at: "${page.mtime}"`,
    `updated_at: "${page.mtime}"`,
    'generated_by: "extracted"',
    'wiki_import:',
    `  wiki_path: ${JSON.stringify(page.vaultRel)}`,
    `  imported_at: "${page.mtime}"`,
    page.links.length === 0 ? 'wiki_links: []' : ['wiki_links:', ...page.links.map(link => `  - ${JSON.stringify(link)}`)].join('\n'),
    '---',
    '',
    page.text.replace(/^\n+/u, '').trimEnd(),
    '',
  ].join('\n')
}

/**
 * Read the vault's page-to-concept index.
 * @param file - the index file path.
 * @returns page path (relative to the vault root) to concept labels; empty when absent.
 */
async function readConcepts(file: string): Promise<ReadonlyMap<string, readonly string[]>> {
  const raw = await readFile(file, 'utf8').catch(() => undefined)
  if (raw === undefined) return new Map()
  const parsed: unknown = JSON.parse(raw)
  const index = (parsed as { file_concepts?: unknown }).file_concepts
  if (index === null || typeof index !== 'object') return new Map()
  const map = new Map<string, readonly string[]>()
  for (const [path, value] of Object.entries(index as Record<string, unknown>)) {
    if (path.startsWith('Wiki/') && Array.isArray(value)) {
      map.set(path, value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== ''))
    }
  }
  return map
}

/** Most related cards one imported card carries. */
const MAX_RELATED = 12

/** Where a wiki link can land: a page of this import, or a card the library already holds. */
interface LinkIndex {
  /** Library-relative page path (without `.md`) to id. */
  readonly byPath: ReadonlyMap<string, string>
  /** Page file-name stem to id, kept only when exactly one page has that stem. */
  readonly byStem: ReadonlyMap<string, string>
  /** Normalized title to id, kept only when exactly one card has that title. */
  readonly byTitle: ReadonlyMap<string, string>
}

/**
 * Index every link target the import can resolve.
 *
 * A link that names a page ambiguously — two pages share that file name — is left
 * unresolved rather than guessed at, and the same holds for a title two cards share.
 *
 * @param pages - the pages this run imports.
 * @param existing - the cards already in the library.
 * @returns the index to resolve links against.
 */
function linkIndexOf(pages: readonly WikiPage[], existing: readonly CardDocument[]): LinkIndex {
  const byPath = new Map<string, string>()
  const stems = new Map<string, string[]>()
  const titles = new Map<string, string[]>()
  const add = (map: Map<string, string[]>, key: string, value: string): void => {
    const found = map.get(key)
    if (found === undefined) map.set(key, [value])
    else found.push(value)
  }
  for (const page of pages) {
    byPath.set(page.rel.replace(/\.md$/u, ''), page.id)
    byPath.set(page.rel, page.id)
    add(stems, stemTitle(stemOf(page.rel)), page.id)
    titles.set(normalizeTitle(page.title), [page.id])
  }
  for (const card of existing) {
    if (card.status === 'deprecated') continue
    add(titles, normalizeTitle(card.title), card.id)
  }
  const unique = (map: Map<string, string[]>): Map<string, string> => {
    const only = new Map<string, string>()
    for (const [key, values] of map) {
      if (values.length === 1) only.set(key, values[0] ?? '')
    }
    return only
  }
  return { byPath, byStem: unique(stems), byTitle: unique(titles) }
}

/**
 * Resolve one page's links into card ids.
 * @param page - the page whose links are resolved.
 * @param index - the targets available.
 * @returns the resolved ids and the targets that resolved to nothing.
 */
function resolveLinks(page: WikiPage, index: LinkIndex): {
  readonly related: readonly string[]
  readonly unresolved: readonly string[]
} {
  const related = new Set<string>()
  const unresolved: string[] = []
  for (const raw of page.links) {
    const target = raw.trim()
    if (target === '') continue
    const found = index.byPath.get(target.replace(/\.md$/u, ''))
      ?? index.byPath.get(target)
      ?? index.byStem.get(stemTitle(basename(target)))
      ?? index.byTitle.get(normalizeTitle(target))
    if (found === undefined || found === '' || found === page.id) {
      unresolved.push(target)
      continue
    }
    related.add(found)
    if (related.size >= MAX_RELATED) break
  }
  return { related: [...related], unresolved }
}

/**
 * Drop pages whose text is byte-identical to an earlier page's.
 *
 * A split export can write one body into many files, which would import as several
 * cards carrying the same prose under different titles. The first page by path wins
 * and the rest are reported, so nothing is dropped silently.
 * @param pages - the candidate pages, path-sorted.
 * @returns the pages to import and a line per dropped copy.
 */
function dedupeByContent(pages: readonly WikiPage[]): {
  readonly pages: readonly WikiPage[]
  readonly skipped: readonly string[]
} {
  const seen = new Map<string, WikiPage>()
  const unique: WikiPage[] = []
  const skipped: string[] = []
  for (const page of pages) {
    const key = createHash('sha256').update(page.text).digest('hex')
    const first = seen.get(key)
    if (first === undefined) {
      seen.set(key, page)
      unique.push(page)
      continue
    }
    skipped.push(`${page.rel}（与 ${first.rel} 逐字节相同）`)
  }
  return { pages: unique, skipped }
}

/** One page as read from disk, before its title is decided. */
interface RawPage {
  /** Absolute path on disk. */
  readonly absolute: string
  /** Path relative to the Wiki root, with `/` separators. */
  readonly rel: string
  /** Whole page text. */
  readonly text: string
  /** Prose characters, by {@link proseOf}. */
  readonly prose: number
  /** The page's `# ` heading, when it has one. */
  readonly heading: string
  /** Source modification time, which every generated timestamp uses. */
  readonly mtime: string
}

const root = flagOf('root') ?? DEFAULT_ROOT
const wiki = flagOf('wiki') ?? DEFAULT_WIKI
const dryRun = process.argv.includes('--dry')
const batchSize = numberFlagOf('batch-size', DEFAULT_BATCH_SIZE)
const onlyBatch = flagOf('batch') === undefined ? undefined : numberFlagOf('batch', 1)
const reportPath = flagOf('report')
const vault = dirname(wiki)
const conceptFile = flagOf('concepts') ?? join(vault, 'wiki-concept-index.json')

const concepts = await readConcepts(conceptFile)
const files = await markdownFiles(wiki)
const skippedNav: string[] = []
const skippedShell: string[] = []
const raw: RawPage[] = []
for (const absolute of files) {
  const rel = relative(wiki, absolute).split(sep).join('/')
  if (NAVIGATION.test(rel)) {
    skippedNav.push(rel)
    continue
  }
  const [text, info] = await Promise.all([readFile(absolute, 'utf8'), stat(absolute)])
  const prose = proseOf(text)
  if (prose < CARD_PROSE) {
    skippedShell.push(rel)
    continue
  }
  raw.push({ absolute, rel, text, prose, heading: headingOf(text), mtime: info.mtime.toISOString() })
}

// A heading two pages share names the series, not the page — five volumes of one case
// digest all open with the digest's name — so the file name is the better title.
const headingCounts = new Map<string, number>()
for (const page of raw) {
  if (page.heading === '' || isGenericHeading(page.heading)) continue
  headingCounts.set(page.heading, (headingCounts.get(page.heading) ?? 0) + 1)
}
const sharedHeadings = [...headingCounts.values()].filter(count => count > 1).length

const candidates: WikiPage[] = []
for (const page of raw) {
  const titled = page.heading !== '' && !isGenericHeading(page.heading) && headingCounts.get(page.heading) === 1
  const id = idOf(page.rel)
  const type = typeOf(page.rel, stemOf(page.rel))
  const vaultRel = `Wiki/${page.rel}`
  const mapped = concepts.get(vaultRel) ?? []
  const base = {
    absolute: page.absolute,
    rel: page.rel,
    vaultRel,
    text: page.text,
    prose: page.prose,
    heading: page.heading,
    titled,
    type,
    title: titled ? page.heading : stemTitle(stemOf(page.rel)),
    domainL2: domainOf(page.rel),
    concept: mapped[0] ?? (stemOf(page.rel).split('-')[0] ?? ''),
    lawRefs: lawRefsOf(page.text),
    links: linksOf(page.text),
    related: [],
    unresolved: [],
    id,
    target: `cards/${type}/${id}.md`,
    mtime: page.mtime,
  }
  candidates.push({ ...base, ...scoresOf(base) })
}
const deduped = dedupeByContent(candidates)

const existing = await listCardDocuments(root)
// Links resolve against this whole run, not against one batch: every batch lands in the
// same breath, so a card never points at something that is not there yet.
const linkIndex = linkIndexOf(deduped.pages, existing)
const pages: WikiPage[] = deduped.pages.map(page => ({ ...page, ...resolveLinks(page, linkIndex) }))
const live = existing.filter(card => card.status !== 'deprecated')
const liveTitles = new Set(live.map(card => normalizeTitle(card.title)))
const collisions = pages.filter(page => liveTitles.has(normalizeTitle(page.title)))
const grouped = new Map<string, string[]>()
for (const page of pages) {
  const key = normalizeTitle(page.title)
  const group = grouped.get(key)
  if (group === undefined) grouped.set(key, [page.rel])
  else group.push(page.rel)
}
const internalDuplicates = [...grouped.entries()].filter(([, members]) => members.length > 1)

const batches: WikiPage[][] = []
for (let index = 0; index < pages.length; index += batchSize) batches.push(pages.slice(index, index + batchSize))

const report = [
  `# Wiki 导入 dry-run 报告`,
  '',
  `- 源：\`${wiki}\``,
  `- 库：\`${root}\`（现况 ${String(existing.length)} 张，在用 ${String(live.length)}）`,
  `- 概念索引：\`${conceptFile}\`（${String(concepts.size)} 页命中）`,
  `- 生成：${new Date().toISOString()}`,
  '',
  '## 取与舍',
  '',
  `| 类别 | 页数 |`,
  `| --- | --- |`,
  `| Wiki 里的 md | ${String(files.length)} |`,
  `| 导航/元数据（不收） | ${String(skippedNav.length)} |`,
  `| 壳页：正文不足 ${String(CARD_PROSE)} 字（不收） | ${String(skippedShell.length)} |`,
  `| 与其他页逐字节相同（只留一张） | ${String(deduped.skipped.length)} |`,
  `| **收成卡片** | **${String(pages.length)}** |`,
  '',
  ...(deduped.skipped.length === 0 ? [] : [
    '### 逐字节重复的页（保留路径最靠前的一张）',
    '',
    ...deduped.skipped.slice(0, 20).map(line => `- ${line}`),
    '',
  ]),
  '## 卡片提案（按卡型 / 业务域）',
  '',
  ...Object.entries(pages.reduce<Record<string, number>>((acc, page) => {
    const key = `${page.type}/${page.domainL2}`
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})).sort((left, right) => right[1] - left[1]).map(([key, count]) => `| ${key} | ${String(count)} |`),
  '',
  '## 字段来源',
  '',
  `| 有可用标题（未回退文件名） | ${String(pages.filter(page => page.titled).length)} / ${String(pages.length)} |`,
  `| 因 H1 被多页共用而回退文件名 | ${String(sharedHeadings)} 个标题 |`,
  `| 概念来自 vault 概念索引 | ${String(pages.filter(page => concepts.has(page.vaultRel)).length)} / ${String(pages.length)} |`,
  `| 带法条依据 | ${String(pages.filter(page => page.lawRefs.length > 0).length)} |`,
  `| 带 wikilink 的页 | ${String(pages.filter(page => page.links.length > 0).length)} |`,
  `| 链接解析成 related_concepts 的页 | ${String(pages.filter(page => page.related.length > 0).length)}（共 ${String(pages.reduce((sum, page) => sum + page.related.length, 0))} 条边） |`,
  `| 未解析的链接目标 | ${String(pages.reduce((sum, page) => sum + page.unresolved.length, 0))} 条（留在 wiki_links，不写 related_concepts） |`,
  `| 无出链的页（可能成为孤立卡，入链会再消掉一部分） | ${String(pages.filter(page => page.related.length === 0).length)} |`,
  `| 置信度 0.9 / 0.6 / 0.35 | ${String(pages.filter(p => p.confidence === 0.9).length)} / ${String(pages.filter(p => p.confidence === 0.6).length)} / ${String(pages.filter(p => p.confidence === 0.35).length)} |`,
  `| 质量分中位 | ${String(pages.map(page => page.quality).sort((a, b) => a - b)[Math.floor(pages.length / 2)] ?? 0)} |`,
  '',
  '## 落库后门禁的预期变化',
  '',
  `- \`duplicate-title\`（与既有在用卡完全同题）：**${String(collisions.length)}**`,
  ...collisions.slice(0, 10).map(page => `  - ${page.rel} ↔ 既有卡`),
  `- \`duplicate-title\`（导入页之间同题，用门禁自己的归一化口径）：**${String(internalDuplicates.length)}** 组`,
  ...internalDuplicates.slice(0, 10).map(([key, members]) => `  - ${members.map(member => basename(member)).join('、')}（${key.slice(0, 30)}）`),
  `- \`unclassified\`：${String(pages.filter(page => page.domainL2 === '未分类').length)} 张（子树没有更具体的域）`,
  `- \`low-confidence\`：${String(pages.filter(page => page.confidence < 0.8).length)} 张`,
  '- `broken-link`：0 —— `related_concepts` 只写解析成功的 id，而它们全部来自本次导入（一次落库，不留"链接指向尚未导入的卡"的中间态）；565 条解析不出的目标留在 `wiki_links`，不参与门禁。',
  `- \`orphan-card\`：最多 ${String(pages.filter(page => page.related.length === 0).length)} 张（无出链的页；入链会再消掉一部分）。`,
  '',
  '## 批次计划',
  '',
  '| 批 | 张数 | 首 … 尾 |',
  '| --- | --- | --- |',
  ...batches.map((batch, index) =>
    `| ${String(index + 1)} | ${String(batch.length)} | ${basename(batch[0]?.rel ?? '')} … ${basename(batch[batch.length - 1]?.rel ?? '')} |`),
  '',
  '## 幂等性',
  '',
  `- 草稿 id 由「目标路径 + 卡片全文」决定，全文里的时间戳取源文件 mtime：同一份 vault 重跑 id 不变。`,
  `- 示例：${pages.slice(0, 3).map(page => `${page.rel} → ${page.id}`).join('；')}`,
  '',
].join('\n')

console.log(report)

const selected = onlyBatch === undefined
  ? []
  : (batches[onlyBatch - 1] ?? [])
if (onlyBatch !== undefined && selected.length === 0) {
  console.error(`dsh-ip-wiki: --batch ${String(onlyBatch)} is out of range (1..${String(batches.length)})`)
  process.exitCode = 2
} else if (reportPath !== undefined) {
  await writeFile(reportPath, report)
  console.log(`报告已写入 ${reportPath}`)
}

if (!dryRun && selected.length > 0) {
  const drafts: CardDraft[] = []
  for (const page of selected) {
    drafts.push(await writeDraft(root, {
      path: page.target,
      content: cardText(page),
      classification: 'public',
      generatedBy: 'human',
      sourceRef: SOURCE_REF,
      note: `Wiki 导入：${page.vaultRel}（正文原样搬运，未改写）。`,
    }, undefined))
  }
  console.log(`已提交第 ${String(onlyBatch)} 批草稿 ${String(drafts.length)} 份：${drafts.map(draft => draft.id).join(', ')}`)
  console.log(`当前待确认草稿：${String((await listDrafts(root)).length)} 份`)
} else if (dryRun) {
  console.log('（dry-run，未写任何草稿）')
} else if (onlyBatch === undefined) {
  console.log(`（未指定 --batch，什么也没写；批次 1..${String(batches.length)}）`)
}
