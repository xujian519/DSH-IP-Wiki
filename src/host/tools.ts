/**
 * The agent-facing tools: search the card library, read one card, check a
 * quotation against the card it claims to come from, and move a card's lifecycle
 * on.
 *
 * Each tool is the same operation the panel calls, so the agent and the panel can
 * never disagree about what the library holds. `ip_wiki_cite` exists because the
 * expensive mistake in this domain is a citation that reads plausibly and is not
 * in the card: it answers whether the quoted text is really there, and with what
 * context. `ip_wiki_confirm` exists because a card the migration wrote is
 * unconfirmed: it queues the one-line status change as a draft instead of writing
 * the card, so the confirmation itself stays a decision someone makes.
 * @module dsh-ip-wiki/host/tools
 */
import type { CardDocument, CardStatus, SearchResult } from '../shared/card'
import { CARD_TYPE_LABEL } from '../shared/card'
import type { CardConfirmProposal, QueuedConfirmation, SkippedConfirmation, SourcePolicy } from './drafts'
import { TIERS, readLintReport, type LintReport, type LintTier } from './lint'
import {
  confirmDraft,
  discardDraft,
  listDrafts,
  proposeCardConfirmations,
  proposeDraft,
  revertDraft,
  viewDraft,
  type CardDraft,
  type DraftKind,
  type DraftView,
} from './drafts'
import { listCardDocuments, readCard } from './library'
import type { SearchService } from './search'

/** One model-facing text block. */
export interface TextBlock {
  /** Content kind the transcript renders. */
  readonly type: 'text'
  /** The rendered text. */
  readonly text: string
}

/** A tool definition as this plugin declares it: the registry adds execution plumbing. */
export interface ToolDefinitionLike {
  /** Tool name the model calls. */
  readonly name: string
  /** What the tool does and when to use it. */
  readonly description: string
  /** JSON schema of the arguments. */
  readonly parameters: Record<string, unknown>
  /** How the settled result is shown. */
  readonly output: {
    /** JSON schema of the result value. */
    readonly schema: Record<string, unknown>
    /**
     * Render the result for the transcript.
     * @param args - the arguments the call carried.
     * @param value - the value `execute` returned.
     * @returns the content blocks.
     */
    render(args: unknown, value: unknown): readonly TextBlock[]
  }
  /**
   * Run the tool.
   * @param args - the arguments the call carried.
   * @returns the result value the renderer receives.
   */
  execute(args: unknown): Promise<unknown>
}

/** The slice of the tool registry this plugin registers into. */
export interface ToolRegistryLike {
  /**
   * Register one definition.
   * @param definition - the tool.
   * @returns the disposer that unregisters it.
   */
  register(definition: ToolDefinitionLike): () => void
}

/** Default number of hits when the caller names none. */
const DEFAULT_LIMIT = 8

/** Greatest number of hits any call may ask for. */
const MAX_LIMIT = 50

/** How many diff lines of a draft a tool result shows before it truncates. */
const MAX_DIFF_LINES = 120

/** How many gate findings a tool result lists before it truncates. */
const MAX_LINT_FINDINGS = 40

/** How many queued confirmations a tool result lists before it truncates. */
const MAX_CONFIRM_LINES = 40

/** The scopes the confirmation tool accepts. */
const CONFIRM_SCOPES = ['all-draft'] as const

/** The actions the review tool answers. */
const REVIEW_ACTIONS = ['list', 'view', 'confirm', 'discard', 'revert'] as const

/** What the material classes are called on the wire. */
const CLASSIFICATIONS = ['public', 'client-material'] as const

/** What may have produced a draft. */
const GENERATED_BY = ['human', 'local-model', 'dsh-model'] as const

/** Read one value as an object, or `undefined`. */
function objectOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * Read one string argument.
 * @param args - the call's arguments.
 * @param key - the field name.
 * @returns the trimmed text, or `undefined` when absent or not text.
 */
export function stringArg(args: unknown, key: string): string | undefined {
  const record = objectOf(args)
  if (record === undefined) return undefined
  const value = record[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * Read one argument that must be one of a closed set.
 * @param args - the call's arguments.
 * @param key - the field name.
 * @param allowed - the accepted values.
 * @returns the value, or `undefined` when it is absent or not in the set.
 */
export function enumArg<T extends string>(
  args: unknown,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const record = objectOf(args)
  const value = record === undefined ? undefined : record[key]
  return allowed.find(candidate => candidate === value)
}

/**
 * Read one argument as a list of non-empty strings.
 * @param args - the call's arguments.
 * @param key - the field name.
 * @returns the trimmed items, or `undefined` when the field is absent or is not a list.
 */
export function listArg(args: unknown, key: string): string[] | undefined {
  const record = objectOf(args)
  const value = record === undefined ? undefined : record[key]
  if (!Array.isArray(value)) return undefined
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item !== '')
}

/**
 * Read one bounded integer argument.
 * @param args - the call's arguments.
 * @param key - the field name.
 * @param fallback - the value to use when the field is absent or unusable.
 * @returns the integer within `[1, MAX_LIMIT]`.
 */
export function limitArg(args: unknown, key: string): number {
  const record = objectOf(args)
  const value = record === undefined ? undefined : record[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return DEFAULT_LIMIT
  return Math.min(Math.floor(value), MAX_LIMIT)
}

/** The lifecycle status's copy in a model-facing line. */
function statusLabel(status: CardStatus): string {
  switch (status) {
    case 'draft':
      return '未确认'
    case 'confirmed':
      return '已确认'
    case 'deprecated':
      return '已废弃'
  }
}

/** Render one search answer. */
function renderSearch(result: SearchResult): string {
  if (result.hits.length === 0) {
    return `没有命中。检索方式：${result.mode}；扫描 ${String(result.scanned)} 张卡片。${result.degraded}`
  }
  const lines = result.hits.map((hit, index) => [
    `${String(index + 1)}. ${hit.title}`,
    `   卡型：${CARD_TYPE_LABEL[hit.type]}｜域：${hit.domainL2}${hit.concept === '' ? '' : `｜概念：${hit.concept}`}`
      + `${hit.status === 'confirmed' ? '' : `｜状态：${statusLabel(hit.status)}`}`,
    hit.lawRefs.length === 0 ? '' : `   法条依据：${hit.lawRefs.join('、')}`,
    `   卡片：${hit.path}`,
    hit.sourcePath === '' ? '' : `   来源：${hit.sourcePath}`,
    `   片段：${hit.snippet}`,
  ].filter(line => line !== '').join('\n'))
  const header = `命中 ${String(result.hits.length)} 张（检索方式：${result.mode}，扫描 ${String(result.scanned)} 张`
    + `${result.deprecated === 0 ? '' : `；已废弃 ${String(result.deprecated)} 张排在末尾`}`
    + `${result.duplicates === 0 ? '' : `；与前一张重复 ${String(result.duplicates)} 张排在末尾`}）`
  return [header, ...lines, result.degraded].filter(line => line !== '').join('\n\n')
}

/** Render one card document. */
function renderCard(document: CardDocument): string {
  return [
    `# ${document.title}`,
    `卡型：${CARD_TYPE_LABEL[document.type]}｜域：${document.domainL2}｜状态：${statusLabel(document.status)}`,
    `卡片：${document.path}`,
    document.lawRefs.length === 0 ? '' : `法条依据：${document.lawRefs.join('、')}`,
    document.sourcePath === '' ? '' : `来源：${document.sourcePath}`,
    '',
    document.body,
  ].filter(line => line !== '').join('\n')
}

/** Collapse whitespace so a quotation matches across line wrapping. */
function flatten(text: string): string {
  return text.replace(/\s+/gu, '')
}

/**
 * The output every tool in this plugin declares: one text block.
 *
 * The registry validates a tool's resolved value against `output.schema` before it
 * renders, so `execute` returns exactly this object. A declaration that described a
 * richer value than `execute` returned would fail every call at dispatch with
 * `INVALID_TOOL_OUTPUT` — the whole plugin's tools were broken that way until a live
 * call reported it, because the acceptance evals called `execute` and `render`
 * directly and never went through the registry.
 */
const TEXT_OUTPUT: ToolDefinitionLike['output'] = {
  schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  render: (_args, value) => [{ type: 'text', text: (value as { text: string }).text }],
}

/**
 * Build the plugin's agent tools.
 * @param deps - the library root and the retrieval service.
 * @returns the definitions, in registration order.
 */
export function ipWikiTools(deps: {
  readonly libraryRoot: string
  readonly search: SearchService
  readonly sourcePolicy?: SourcePolicy | undefined
  readonly lintFailOn?: LintTier | undefined
}): ToolDefinitionLike[] {
  return [
    {
      name: 'ip_wiki_search',
      description: '在本地 IP 知识库（分型卡片库）里检索：返回命中卡片、片段与出处（法条 / 来源路径）。'
        + '优先用语义 + 精排（本机 bge-m3），不可用时自动退回关键词，结果里的「检索方式」会说明实际用了哪一级。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索问题或关键词（中文可用）。' },
          limit: { type: 'integer', description: `返回条数，默认 ${String(DEFAULT_LIMIT)}，最多 ${String(MAX_LIMIT)}。` },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const query = stringArg(args, 'query')
        if (query === undefined) throw new Error('ip_wiki_search: query 必填，且必须是非空字符串')
        return { text: renderSearch(await deps.search.search(query, limitArg(args, 'limit'))) }
      },
    },
    {
      name: 'ip_wiki_get',
      description: '按卡片路径读取一张 IP 知识卡片的完整正文（含卡型、域、状态、法条依据、来源）。'
        + '路径从 ip_wiki_search 的结果里取，形如 cards/rule/....md。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '卡片的库内相对路径。' } },
        required: ['path'],
        additionalProperties: false,
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const path = stringArg(args, 'path')
        if (path === undefined) throw new Error('ip_wiki_get: path 必填，且必须是非空字符串')
        const document = await readCard(deps.libraryRoot, path)
        if (document === undefined) throw new Error(`ip_wiki_get: 库里没有这张卡片：${path}`)
        return { text: renderCard(document) }
      },
    },
    {
      name: 'ip_wiki_cite',
      description: '核对一处引用：给出卡片路径与要引用的原文，返回该原文是否逐字存在于卡片中，以及它前后的上下文。'
        + '引用前先核对，可以对上再引用；对不上就换一张卡片或换一句话。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '卡片的库内相对路径。' },
          quote: { type: 'string', description: '你打算引用的原文（忽略空白与换行差异）。' },
        },
        required: ['path', 'quote'],
        additionalProperties: false,
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const path = stringArg(args, 'path')
        const quote = stringArg(args, 'quote')
        if (path === undefined) throw new Error('ip_wiki_cite: path 必填，且必须是非空字符串')
        if (quote === undefined) throw new Error('ip_wiki_cite: quote 必填，且必须是非空字符串')
        const document = await readCard(deps.libraryRoot, path)
        if (document === undefined) throw new Error(`ip_wiki_cite: 库里没有这张卡片：${path}`)
        return { text: renderVerdict(verifyCitation(document, quote)) }
      },
    },
    {
      name: 'ip_wiki_draft',
      description: '把素材归纳成一张分型卡片的**草稿**（不落库）；带 supersedes 时这是一次合并，'
        + '确认后除写入合并卡外，还会把列出的重复卡标为 deprecated（可回滚）。返回目标路径、策略与实际差异。'
        + '素材是客户材料时（classification="client-material"）默认只允许本地模型处理，声明 generatedBy="dsh-model" 会被拒绝。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目标卡片路径，形如 cards/rule/xxx.md（须与内容里的 type 一致）。' },
          content: { type: 'string', description: '整张卡的文本：YAML frontmatter（至少含 type/title）+ Markdown 正文。' },
          classification: { type: 'string', enum: [...CLASSIFICATIONS], description: '素材来源类别。' },
          generatedBy: { type: 'string', enum: [...GENERATED_BY], description: '这份文本由谁生成。' },
          sourceRef: { type: 'string', description: '素材出处：文件路径 / URL / 会话 id。' },
          note: { type: 'string', description: '给确认者看的一句话说明。' },
          supersedes: {
            type: 'array',
            items: { type: 'string' },
            description: '合并时要弃用的重复卡路径（先跑 ip_wiki_lint 看 duplicate-title 命中了哪些）；'
              + '确认后它们会被标为 deprecated 并写 superseded_by，可回滚。',
          },
        },
        required: ['path', 'content', 'classification', 'generatedBy'],
        additionalProperties: false,
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const path = stringArg(args, 'path')
        const content = stringArg(args, 'content')
        const classification = enumArg(args, 'classification', CLASSIFICATIONS)
        const generatedBy = enumArg(args, 'generatedBy', GENERATED_BY)
        if (path === undefined) throw new Error('ip_wiki_draft: path 必填')
        if (content === undefined) throw new Error('ip_wiki_draft: content 必填')
        if (classification === undefined) throw new Error(`ip_wiki_draft: classification 必须是 ${CLASSIFICATIONS.join(' / ')} 之一`)
        if (generatedBy === undefined) throw new Error(`ip_wiki_draft: generatedBy 必须是 ${GENERATED_BY.join(' / ')} 之一`)
        const sourceRef = stringArg(args, 'sourceRef')
        const note = stringArg(args, 'note')
        const supersedes = listArg(args, 'supersedes')
        return {
          text: renderDraft(await proposeDraft(deps.libraryRoot, {
            path,
            content,
            classification,
            generatedBy,
            ...(sourceRef === undefined ? {} : { sourceRef }),
            ...(note === undefined ? {} : { note }),
            ...(supersedes === undefined ? {} : { supersedes }),
          }, deps.sourcePolicy)),
        }
      },
    },
    {
      name: 'ip_wiki_review',
      description: '草稿的查看与裁决：action=list 列待确认草稿；view 看某份草稿与差异；'
        + 'confirm 落库（会先备份被替换的卡片，可 revert 回滚）；discard 作废；revert 撤销一次已确认的落库。'
        + '未经 confirm 的草稿不会出现在检索结果里。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: [...REVIEW_ACTIONS], description: '要做的动作。' },
          id: { type: 'string', description: '草稿 id（action=list 之外必填）。' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const action = enumArg(args, 'action', REVIEW_ACTIONS)
        if (action === undefined) throw new Error(`ip_wiki_review: action 必须是 ${REVIEW_ACTIONS.join(' / ')} 之一`)
        if (action === 'list') {
          return { text: renderDraftList(await listDrafts(deps.libraryRoot)) }
        }
        const id = stringArg(args, 'id')
        if (id === undefined) throw new Error(`ip_wiki_review: action=${action} 需要 id`)
        if (action === 'view') {
          const view = await viewDraft(deps.libraryRoot, id)
          if (view === undefined) throw new Error(`ip_wiki_review: 没有这份草稿：${id}`)
          return { text: renderDraft(view) }
        }
        if (action === 'confirm') {
          const done = await confirmDraft(deps.libraryRoot, id)
          return {
            text: `✅ 已落库：${done.path}（${done.action === 'replaced' ? '替换了原卡片，已备份，可用 revert 回滚' : '新建卡片，可用 revert 删除'}）`,
          }
        }
        if (action === 'discard') {
          await discardDraft(deps.libraryRoot, id)
          return { text: `已作废草稿 ${id}（未写库）。` }
        }
        const undone = await revertDraft(deps.libraryRoot, id)
        return {
          text: `↩️ 已回滚：${undone.path}（${undone.action === 'restored' ? '恢复为确认前的原文' : '删除了本次新建的卡片'}）`,
        }
      },
    },
    {
      name: 'ip_wiki_confirm',
      description: '把已经入库、但状态仍是「未确认」的卡片提交为**待确认草稿**：确认只改 frontmatter 的 status 一行'
        + '（draft → confirmed），正文与其它字段一字不动。草稿仍要由用户在面板里确认（或 ip_wiki_review action="confirm"）才落库，'
        + '落库前会先备份、可回滚。paths 指名要提交的卡片；scope="all-draft" 提交库里全部未确认的卡片。',
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: '要提交确认的卡片路径（来自 ip_wiki_search / ip_wiki_get 的结果）。',
          },
          scope: {
            type: 'string',
            enum: [...CONFIRM_SCOPES],
            description: '不指名路径时，用 all-draft 提交库里全部未确认的卡片。',
          },
        },
        additionalProperties: false,
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const named = listArg(args, 'paths') ?? []
        const scope = enumArg(args, 'scope', CONFIRM_SCOPES)
        if (named.length === 0 && scope === undefined) {
          throw new Error('ip_wiki_confirm: 要么给 paths，要么给 scope="all-draft"')
        }
        const paths = named.length > 0 ? named : await unconfirmedPaths(deps.libraryRoot)
        return {
          text: renderConfirmations(await proposeCardConfirmations(deps.libraryRoot, paths, deps.sourcePolicy)),
        }
      },
    },
    {
      name: 'ip_wiki_lint',
      description: '对卡片库跑一次质量门禁，返回分档结论：'
        + 'critical=卡片不可用（缺标题、正文为空）；warning=库不一致（断链、标题重复、索引漂移/缺失）；'
        + 'suggestion=值得人工看一眼（未分类、缺概念标签、低置信、孤立卡）。'
        + '交付或批量整理前后各跑一次，用 failOn 决定以哪一档为失败线。',
      parameters: {
        type: 'object',
        properties: {
          failOn: { type: 'string', enum: [...TIERS], description: '以哪一档为失败线，默认取部署配置（warning）。' },
        },
        additionalProperties: false,
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const requested = enumArg(args, 'failOn', TIERS)
        return { text: renderLint(await readLintReport(deps.libraryRoot, requested ?? deps.lintFailOn ?? 'warning')) }
      },
    },
  ]
}

/** Render one draft and the difference it would make. */
function renderDraft(view: DraftView): string {
  const { draft, counts } = view
  const lines = view.diff.map(line => {
    const mark = line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '
    return `${mark}${line.text}`
  })
  const shown = lines.slice(0, MAX_DIFF_LINES)
  const absorbed = draft.supersedes.length === 0 ? [] : [
    `合并：确认后将弃用 ${String(draft.supersedes.length)} 张卡（标为 status: deprecated 并加 superseded_by）`,
    ...draft.supersedes.map(path => `  - ${path}`),
  ]
  return [
    `草稿 ${draft.id}（待确认${draft.kind === 'merge' ? '，合并' : draft.kind === 'status' ? '，状态确认' : ''}）`,
    `目标：${draft.target}（${view.existing ? '将替换现有卡片' : '新建卡片'}）`,
    `卡型：${CARD_TYPE_LABEL[draft.type]}｜标题：${draft.title}`,
    `来源：${draft.classification} / ${draft.generatedBy}${draft.sourceRef === '' ? '' : ` / ${draft.sourceRef}`}`,
    `来源策略：${draft.policy}`,
    draft.note === '' ? '' : `备注：${draft.note}`,
    `差异：+${String(counts.added)} / -${String(counts.removed)} 行`,
    ...absorbed,
    '',
    ...shown,
    lines.length > shown.length ? `…（还有 ${String(lines.length - shown.length)} 行，请在面板里查看完整差异）` : '',
    '',
    '确认落库请调用 ip_wiki_review(action="confirm", id="…")；用户也可以在面板里确认。',
  ].filter(line => line !== '').join('\n')
}

/** The mark one tier carries in a rendered report. */
function tierMark(tier: LintTier): string {
  switch (tier) {
    case 'critical':
      return '⛔'
    case 'warning':
      return '⚠️'
    case 'suggestion':
      return '·'
  }
}

/** Render one gate report. */
function renderLint(report: LintReport): string {
  const counts = `critical ${String(report.counts.critical)} / warning ${String(report.counts.warning)} / suggestion ${String(report.counts.suggestion)}`
  const header = `质量门禁：${report.verdict === 'pass' ? '✅ 通过' : '❌ 未通过'}（失败线 ${report.failOn}）｜扫描 ${String(report.scanned)} 张｜${counts}`
  if (report.findings.length === 0) return `${header}\n没有发现任何问题。`
  const shown = report.findings.slice(0, MAX_LINT_FINDINGS).map(finding =>
    `${tierMark(finding.tier)} [${finding.code}] ${finding.path === '' ? '(库级)' : finding.path}：${finding.message}`)
  return [
    header,
    ...shown,
    report.findings.length > shown.length ? `…（还有 ${String(report.findings.length - shown.length)} 条）` : '',
  ].filter(line => line !== '').join('\n')
}

/** Every card the library holds whose status is still unconfirmed, path-ordered. */
async function unconfirmedPaths(root: string): Promise<string[]> {
  const cards = await listCardDocuments(root)
  return cards
    .filter(card => card.status === 'draft')
    .map(card => card.path)
    .sort((left, right) => left.localeCompare(right))
}

/** Render one confirmation batch. */
function renderConfirmations(proposals: readonly CardConfirmProposal[]): string {
  const queued = proposals.filter((proposal): proposal is QueuedConfirmation => proposal.action === 'queued')
  const skipped = proposals.filter((proposal): proposal is SkippedConfirmation => proposal.action === 'skipped')
  const listed = queued.slice(0, MAX_CONFIRM_LINES)
  const skipLines = skipped.slice(0, MAX_CONFIRM_LINES).map(proposal =>
    `- ${proposal.path}｜${proposal.reason === 'already-confirmed' ? '已是已确认' : '已废弃'}`)
  return [
    `已提交 ${String(queued.length)} 份状态确认草稿（跳过 ${String(skipped.length)} 张）。`,
    queued.length === 0 ? '' : '待确认草稿（在面板「待确认草稿」里确认，或 ip_wiki_review(action="confirm", id="…")）：',
    ...listed.map(proposal => `- ${proposal.id}｜${proposal.path}`),
    queued.length > listed.length ? `…（还有 ${String(queued.length - listed.length)} 份）` : '',
    skipped.length === 0 ? '' : '已跳过：',
    ...skipLines,
    skipped.length > skipLines.length ? `…（还有 ${String(skipped.length - skipLines.length)} 张）` : '',
    '确认只改 status 一行，落库前先备份，可用 ip_wiki_review(action="revert", id="…") 回滚。',
  ].filter(line => line !== '').join('\n')
}

/** The kind mark a rendered draft list carries. */
function kindMark(kind: DraftKind): string {
  switch (kind) {
    case 'card':
      return ''
    case 'merge':
      return '｜合并'
    case 'status':
      return '｜状态确认'
  }
}

/** Render the pending drafts. */
function renderDraftList(drafts: readonly CardDraft[]): string {
  if (drafts.length === 0) return '没有待确认的草稿。'
  return [
    `待确认草稿 ${String(drafts.length)} 份：`,
    ...drafts.map(draft =>
      `- ${draft.id}${kindMark(draft.kind)}｜${draft.target}｜${CARD_TYPE_LABEL[draft.type]}｜${draft.title}｜${draft.classification}/${draft.generatedBy}｜${draft.createdAt}`),
  ].join('\n')
}

/** The result of checking one quotation. */
export interface CiteVerdict {
  /** Whether the quotation is verbatim in the card. */
  readonly found: boolean
  /** The card that was checked. */
  readonly path: string
  /** The quotation as it was submitted. */
  readonly quote: string
  /** The surrounding text when it was found, or empty text when it was not. */
  readonly context: string
}

/**
 * Check one quotation against one card.
 * @param document - the card to check.
 * @param quote - the text the caller wants to cite.
 * @returns the verdict, with surrounding context when the text is there.
 */
export function verifyCitation(document: CardDocument, quote: string): CiteVerdict {
  const haystack = flatten(document.body)
  const needle = flatten(quote)
  const at = haystack.indexOf(needle)
  if (at < 0) return { found: false, path: document.path, quote, context: '' }
  return {
    found: true,
    path: document.path,
    quote,
    context: haystack.slice(Math.max(0, at - 60), at + needle.length + 60),
  }
}

/** Render one citation verdict. */
function renderVerdict(verdict: CiteVerdict): string {
  return verdict.found
    ? `✅ 逐字命中：${verdict.path}\n引用：${verdict.quote}\n上下文：…${verdict.context}…`
    : `❌ 卡片里没有这段原文：${verdict.path}\n你想引用的：${verdict.quote}\n请换一张卡片，或改用卡片里已有的表述。`
}
