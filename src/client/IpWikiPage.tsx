/**
 * The IP knowledge library panel.
 *
 * One screen holds everything the card library has: the status strip that says
 * where the library is, whether its derived index agrees with the cards, and
 * whether the quality gate currently passes; the tree that groups cards by kind
 * and domain beside the report list; and the reader that renders the selected
 * card, report, pending draft, or gate report.
 *
 * The panel reads the library and confirms what is already waiting as a draft. It
 * never invents a draft of its own: every card write here goes through the same
 * `confirmDraft` the Host exposes on `/draft/confirm`, which backs the replaced
 * card up first, so anything this screen lands can be reverted from this screen.
 * @module dsh-ip-wiki/client/LibraryPanel
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  CardDocument,
  IndexDrift,
  LibraryStatus,
  LibraryTree,
  ReportDocument,
  SearchHit,
  SearchMode,
  SearchResult,
  SearchStatus,
} from '../shared/card'
import { CARD_TYPE_LABEL } from '../shared/card'
import type { CardDraft, DraftView } from '../host/drafts'
import type { LintFinding, LintReport, LintTier } from '../host/lint'
import type { DiffLine } from '../shared/diff'
import type { HostApi } from './host-api'
import { Markdown, headingsOf, type WikilinkAccess } from './markdown'
import { dictionaryFor, type MessageKey } from './locales'
import { libraryStyles } from './styles'

/** How many hits one panel search asks for. */
const SEARCH_LIMIT = 10

/** Dictionary the panel renders with. */
type Messages = Readonly<Record<MessageKey, string>>

/** What the panel's slot injects. */
export interface LibraryPanelProps {
  /** The Client's access to the library routes. */
  readonly api: HostApi
  /** Active locale id, from the Client locale service. */
  readonly localeId: string
}

/** What the reader pane is showing. */
type Selection =
  | { readonly kind: 'card'; readonly document: CardDocument }
  | { readonly kind: 'report'; readonly document: ReportDocument }
  | { readonly kind: 'draft'; readonly view: DraftView }
  | { readonly kind: 'lint'; readonly report: LintReport }

/** The message one failure renders as. */
function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Bring one rendered body heading into view. */
function showHeading(id: string): void {
  for (const heading of document.querySelectorAll(`#${id}`)) {
    heading.scrollIntoView({ block: 'start' })
  }
}

/**
 * An index from every name a card answers to, to its path.
 *
 * Cards link by id (`related_concepts`) and by page name — the imported file's
 * stem without its `wiki-` prefix and trailing revision hash — so one resolver
 * answers both instead of each caller guessing which one it holds.
 * @param tree - the library tree, or `null` before it arrives.
 * @returns a resolver that answers with the linked card's path, or `undefined`.
 */
function linkResolver(tree: LibraryTree | null): (name: string) => string | undefined {
  const byName = new Map<string, string>()
  for (const branch of tree?.branches ?? []) {
    for (const group of branch.groups) {
      for (const card of group.cards) {
        const stem = card.path.slice(card.path.lastIndexOf('/') + 1).replace(/\.md$/u, '')
        const page = stem.replace(/^wiki-/u, '').replace(/-[0-9a-f]{8}$/u, '')
        for (const name of [card.id, card.title, stem, page]) {
          if (name !== '' && !byName.has(name)) byName.set(name, card.path)
        }
      }
    }
  }
  return name => byName.get(name)
}

/** 路径到标题。空标题与树上没有的路径都交给短路径。 */
function titlesByPath(tree: LibraryTree | null): ReadonlyMap<string, string> {
  const titles = new Map<string, string>()
  for (const branch of tree?.branches ?? []) {
    for (const group of branch.groups) {
      for (const card of group.cards) titles.set(card.path, card.title)
    }
  }
  return titles
}

/** 路径最后一段。没有卡片标题时，将弃用列表用它代替整段路径。 */
function shortPath(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/**
 * Tone of one gate chip.
 *
 * Pass takes the ok dot. A fail takes the error dot only when a critical finding
 * exists; warnings alone stay on the warn dot. The caller omits the chip entirely
 * while the report is still unread, so the strip never flashes red.
 */
function gateTone(lint: LintReport): string {
  switch (lint.verdict) {
    case 'pass':
      return 'iw-chip-ok'
    case 'fail':
      return lint.counts.critical > 0 ? 'iw-chip-error' : 'iw-chip-warn'
  }
}

/**
 * Copy for the status strip's gate chip.
 *
 * Zero counts are left out, and suggestions stay off this row: they are the bulk
 * of a large library and the reader already lists them.
 */
function gateStripText(lint: LintReport, t: Messages): string {
  switch (lint.verdict) {
    case 'pass':
      return t.lintStripPass
    case 'fail': {
      const parts = [t.lintStripFail]
      if (lint.counts.critical > 0) parts.push(`${t.lintStripCritical} ${String(lint.counts.critical)}`)
      if (lint.counts.warning > 0) parts.push(`${t.lintStripWarning} ${String(lint.counts.warning)}`)
      return parts.join(' · ')
    }
  }
}

/** The drift chip's copy and tone. */
function driftOf(drift: IndexDrift, t: Messages): { text: string; tone: string } {
  switch (drift) {
    case 'none':
      return { text: t.driftNone, tone: 'iw-chip-ok' }
    case 'missing':
      return { text: t.driftMissing, tone: 'iw-chip-warn' }
    case 'count-mismatch':
      return { text: t.driftMismatch, tone: 'iw-chip-warn' }
    case 'unreadable':
      return { text: t.driftUnreadable, tone: 'iw-chip-error' }
  }
}

/**
 * 树行悬停文案：标题始终在，概念和相关条数只在有内容时附上。
 * 筛选把分组拿掉之后，卡型也放进悬停，行内仍只留状态。
 */
function cardRowTitle(
  card: { readonly title: string; readonly concept: string; readonly relatedCount: number },
  t: Messages,
  typeLabel = '',
): string {
  const parts = [card.title]
  if (typeLabel !== '') parts.push(typeLabel)
  if (card.concept !== '') parts.push(`${t.concept} ${card.concept}`)
  if (card.relatedCount > 0) parts.push(`${t.related} ${String(card.relatedCount)}`)
  return parts.join(' · ')
}

/** The lifecycle status's copy. */
function statusText(status: string, t: Messages): string {
  switch (status) {
    case 'confirmed':
      return t.statusConfirmed
    case 'deprecated':
      return t.statusDeprecated
    default:
      return t.statusDraft
  }
}

/** One labelled chip. */
function Chip({ label, value, tone }: { readonly label: string; readonly value: string | number; readonly tone?: string }): ReactNode {
  return (
    <span className={tone === undefined ? 'iw-chip' : `iw-chip ${tone}`}>
      {label}
      <b>{value}</b>
    </span>
  )
}

/** One key/value row of the reader's fact grid. */
function Fact({ name, value }: { readonly name: string; readonly value: string }): ReactNode {
  if (value === '') return null
  return (
    <>
      <span className="iw-fact-key">{name}</span>
      <span className="iw-fact-value">{value}</span>
    </>
  )
}

/**
 * 状态条两档。
 *
 * 默认一行回答「库有多大、有没有未确认、索引健不健康、门禁过不过、有没有待审」。
 * 卡型分项、整理报告数，以及已确认数和索引生成时间，收在「详情」里。
 * 门禁报告还没到时不放 chip，避免在读取完成前闪红。
 */
function StatusStrip({ status, lint, t, onOpenLint }: {
  readonly status: LibraryStatus
  readonly lint: LintReport | null
  readonly t: Messages
  readonly onOpenLint: () => void
}): ReactNode {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const drift = driftOf(status.indexDrift, t)
  const unconfirmed = status.counts.byStatus['draft'] ?? 0
  const confirmed = status.counts.byStatus['confirmed'] ?? 0
  return (
    <header className="iw-head iw-status">
      <div className="iw-status-main">
        <Chip label={t.cards} value={status.counts.total} />
        {unconfirmed === 0 ? null : <Chip label={t.unconfirmed} value={unconfirmed} tone="iw-chip-warn" />}
        <span className={`iw-chip ${drift.tone}`}>{drift.text}</span>
        {lint === null ? null : (
          <button type="button" className={`iw-chip ${gateTone(lint)}`} onClick={onOpenLint}>
            {gateStripText(lint, t)}
          </button>
        )}
        {status.needsReview.length === 0 ? null : (
          <Chip label={t.reviewStrip} value={status.needsReview.length} tone="iw-chip-warn" />
        )}
        <button
          type="button"
          className="iw-status-toggle"
          aria-expanded={detailsOpen}
          onClick={() => { setDetailsOpen(open => !open) }}
        >
          <span className="iw-caret" aria-hidden="true">{detailsOpen ? '▼' : '▶'}</span>
          {t.statusDetails}
        </button>
      </div>
      <div className="iw-status-extra" hidden={!detailsOpen}>
        {Object.entries(status.counts.byType).map(([type, count]) => (
          <Chip key={type} label={CARD_TYPE_LABEL[type as keyof typeof CARD_TYPE_LABEL] ?? type} value={count} />
        ))}
        <Chip label={t.reports} value={status.reports.length} />
        {confirmed === 0 ? null : <Chip label={t.statusConfirmed} value={confirmed} tone="iw-chip-ok" />}
        <Chip label={t.index} value={status.indexGeneratedAt ?? t.indexMissing} />
      </div>
    </header>
  )
}

/** The reader pane for one card. */
function CardReader({ document, t, busy, wiki, confirming, onAskDelete, onCancelDelete, onDelete }: {
  readonly document: CardDocument
  readonly t: Messages
  readonly busy: boolean
  readonly wiki: WikilinkAccess
  readonly confirming: boolean
  readonly onAskDelete: () => void
  readonly onCancelDelete: () => void
  readonly onDelete: () => void
}): ReactNode {
  // The heading that repeats the card's own title is neither rendered again nor
  // listed, so the contents matches what the reader can actually reach.
  const headings = headingsOf(document.body)
    .filter((heading, index) => index !== 0 || heading.text.trim() !== document.title.trim())
  const related = document.relatedConcepts
  return (
    <article>
      <div className="iw-read-actions">
        <h2 className="iw-read-title">{document.title}</h2>
        <button type="button" className="iw-btn iw-btn-danger" disabled={busy} onClick={onAskDelete}>
          {t.deleteCard}
        </button>
      </div>
      <div className="iw-meta">
        <Chip label={t.type} value={CARD_TYPE_LABEL[document.type]} />
        <Chip label={t.domain} value={document.domainL2} />
        {document.concept === '' ? null : <Chip label={t.concept} value={document.concept} />}
        <Chip label={t.status} value={statusText(document.status, t)} />
        {document.needsReview ? <Chip label={t.needsReview} value="" tone="iw-chip-warn" /> : null}
        {document.supersededBy === '' ? null : <Chip label={t.supersededBy} value={document.supersededBy} tone="iw-chip-warn" />}
      </div>
      {!confirming ? null : (
        <div className="iw-confirm iw-confirm-stack">
          <span className="iw-confirm-ask">{t.deleteCardAsk}</span>
          <div className="iw-confirm-actions">
            <button type="button" className="iw-btn iw-btn-danger" onClick={onDelete}>{t.deleteCardYes}</button>
            <button type="button" className="iw-btn iw-btn-quiet" onClick={onCancelDelete}>{t.cancel}</button>
          </div>
        </div>
      )}
      <details className="iw-details">
        <summary>{t.metadata}</summary>
        <div className="iw-facts">
          <Fact name={t.confidence} value={document.confidence === undefined ? '' : document.confidence.toFixed(2)} />
          <Fact name={t.quality} value={document.quality === undefined ? '' : document.quality.toFixed(2)} />
          <Fact name={t.jurisdiction} value={document.jurisdiction} />
          <Fact name={t.lawRefs} value={document.lawRefs.join('、')} />
          <Fact name={t.source} value={document.sourcePath} />
          <Fact name="id" value={document.id} />
          <Fact name="path" value={document.path} />
        </div>
      </details>
      {related.length === 0 ? null : (
        <section className="iw-related">
          <div className="iw-section-title">{`${t.relatedHeading} · ${String(related.length)}`}</div>
          <div className="iw-related-list">
            {related.map(name => {
              const path = wiki.resolve(name)
              // 库里没有的 id 保持文本：注明「不在库内」，并且不许看起来像点了没反应的控件。
              return path === undefined
                ? <span key={name} className="iw-related-unresolved">{`${name} · ${t.relatedUnresolved}`}</span>
                : (
                  <button
                    key={name}
                    type="button"
                    className="iw-wikilink iw-wikilink-open"
                    onClick={() => { wiki.open(path) }}
                  >
                    {name}
                  </button>
                )
            })}
          </div>
        </section>
      )}
      {headings.length < 2 ? null : (
        <details className="iw-toc" open>
          <summary className="iw-section-title">{t.toc}</summary>
          <nav className="iw-toc-list">
            {headings.map(heading => (
              <button
                key={heading.id}
                type="button"
                className="iw-toc-item"
                data-level={heading.level}
                onClick={() => { showHeading(heading.id) }}
              >
                {heading.text}
              </button>
            ))}
          </nav>
        </details>
      )}
      <Markdown text={document.body} omitLeadingHeading={document.title} wikilink={wiki} />
    </article>
  )
}

/** The copy for one retrieval stage. */
function modeLabel(stage: SearchMode, t: Messages): string {
  switch (stage) {
    case 'keyword':
      return t.searchModeKeyword
    case 'vector':
      return t.searchModeVector
    case 'rerank':
      return t.searchModeRerank
  }
}

/**
 * 一条检索命中，单独成卡。
 *
 * 不用树行的 `.iw-row`：树行是 30px 的扫描行，命中要同时放下标题、状态、
 * 卡型及其下的域、片段，以及可折的出处。出处的 `details` 放在按钮外面，
 * 折叠控件不能塞进按钮。
 */
function HitRow({ hit, t, selected, onOpen }: {
  readonly hit: SearchHit
  readonly t: Messages
  readonly selected: boolean
  readonly onOpen: (path: string) => void
}): ReactNode {
  const provenance = [...hit.lawRefs, hit.sourcePath].filter(part => part !== '')
  return (
    <div className="iw-hit" data-selected={selected ? 'true' : 'false'}>
      <button type="button" className="iw-hit-open" onClick={() => { onOpen(hit.path) }}>
        <span className="iw-hit-head">
          <span className="iw-hit-title">{hit.title}</span>
          <span className="iw-hit-score">{`${t.score} ${hit.score.toFixed(1)}`}</span>
        </span>
        <span className="iw-hit-status" data-status={hit.status}>{`${t.status} ${statusText(hit.status, t)}`}</span>
        <span className="iw-hit-layers">
          <span className="iw-hit-type">{CARD_TYPE_LABEL[hit.type]}</span>
          <span className="iw-hit-domain">{hit.domainL2}</span>
        </span>
        <span className="iw-hit-matched">{hit.matched.map(stage => modeLabel(stage, t)).join(' + ')}</span>
        <span className="iw-hit-snippet">{hit.snippet}</span>
      </button>
      {provenance.length === 0 ? null : (
        <details className="iw-hit-source">
          <summary>{t.provenance}</summary>
          <span className="iw-hit-source-body">{provenance.join(' · ')}</span>
        </details>
      )}
    </div>
  )
}

/** The difference a draft would make, marked the way a review reads it. */
function DiffView({ diff, t }: { readonly diff: readonly DiffLine[]; readonly t: Messages }): ReactNode {
  return (
    <section>
      <div className="iw-section-title">{t.diffTitle}</div>
      <pre className="iw-diff">
        {diff.map((line, index) => (
          <div key={`d${String(index)}`} className={`iw-diff-${line.kind}`}>
            {line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '- ' : '  '}
            {line.text}
          </div>
        ))}
      </pre>
    </section>
  )
}

/**
 * 阅读器头上的种类芯片。
 *
 * 用词与队列短标签同一套（卡 / 合并），合并带条数；状态确认用全文并加 warn。
 * 队列行仍走 `draftKindLabel`，不套这个芯片。
 */
function draftKindChip(draft: CardDraft, t: Messages): ReactNode {
  switch (draft.kind) {
    case 'card':
      return <span className="iw-chip iw-chip-kind">{t.draftKindCard}</span>
    case 'merge':
      return <span className="iw-chip iw-chip-kind">{`${t.draftKindMerge} · ${String(draft.supersedes.length)}`}</span>
    case 'status':
      return <span className="iw-chip iw-chip-kind iw-chip-warn">{t.statusConfirm}</span>
  }
}

/** 将弃用一行的可见文字：树上有标题就用标题，否则用短路径。 */
function supersedeLabel(path: string, titles: ReadonlyMap<string, string>): string {
  const title = titles.get(path) ?? ''
  return title === '' ? shortPath(path) : title
}

/**
 * 一份草稿的阅读区。
 *
 * 先看种类、备注和差异，确认落库在差异下面。作废在标题行，第一下只展开确认条。
 */
function DraftReader({ view, titles, t, busy, onConfirm, onDiscard, onOpenCard }: {
  readonly view: DraftView
  readonly titles: ReadonlyMap<string, string>
  readonly t: Messages
  readonly busy: boolean
  readonly onConfirm: () => void
  readonly onDiscard: () => void
  readonly onOpenCard: (path: string) => void
}): ReactNode {
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const draft = view.draft
  return (
    <article>
      <div className="iw-read-actions">
        <h2 className="iw-read-title">{draft.title === '' ? draft.target : draft.title}</h2>
        <button
          type="button"
          className="iw-btn iw-btn-danger"
          disabled={busy}
          onClick={() => { setConfirmingDiscard(true) }}
        >
          {t.discard}
        </button>
      </div>
      <div className="iw-meta iw-draft-meta">
        {draftKindChip(draft, t)}
        <Chip label={t.type} value={CARD_TYPE_LABEL[draft.type]} />
        <span className="iw-chip">{t.draftTarget}<b>{draft.target}</b></span>
        <span className={draft.policy === 'local-only' ? 'iw-chip iw-chip-warn' : 'iw-chip'}>
          {t.draftPolicy}<b>{draft.policy === 'local-only' ? t.draftLocalOnly : draft.policy}</b>
        </span>
        <span className="iw-chip">{t.draftOrigin}<b>{`${draft.classification} / ${draft.generatedBy}`}</b></span>
        <span className="iw-chip">{view.existing ? t.willReplace : t.willCreate}</span>
        <span className="iw-chip">{t.diffTitle}<b>{`+${String(view.counts.added)} / -${String(view.counts.removed)}`}</b></span>
      </div>
      {!confirmingDiscard ? null : (
        <div className="iw-confirm iw-confirm-stack">
          <span className="iw-confirm-ask">{t.discardAsk}</span>
          <div className="iw-confirm-actions">
            <button type="button" className="iw-btn iw-btn-danger" disabled={busy} onClick={onDiscard}>{t.discardYes}</button>
            <button type="button" className="iw-btn iw-btn-quiet" onClick={() => { setConfirmingDiscard(false) }}>{t.cancel}</button>
          </div>
        </div>
      )}
      {draft.note === '' ? null : <div className="iw-hint">{draft.note}</div>}
      {draft.sourceRef === '' ? null : <div className="iw-hint">{`${t.source}：${draft.sourceRef}`}</div>}
      {draft.supersedes.length === 0 ? null : (
        <section className="iw-supersedes">
          <div className="iw-section-title">{`${t.mergeAbsorb} · ${String(draft.supersedes.length)}`}</div>
          <div className="iw-supersedes-list">
            {draft.supersedes.map(path => (
              <button
                key={path}
                type="button"
                title={path}
                className="iw-wikilink iw-wikilink-open"
                onClick={() => { onOpenCard(path) }}
              >
                {supersedeLabel(path, titles)}
              </button>
            ))}
          </div>
          <div className="iw-hint">{t.mergeNote}</div>
        </section>
      )}
      <DiffView diff={view.diff} t={t} />
      <div className="iw-actions">
        <button type="button" className="iw-btn iw-btn-primary" disabled={busy} onClick={onConfirm}>{t.confirm}</button>
      </div>
    </article>
  )
}

/** The gate's tiers, in the order a reviewer reads them. */
const LINT_TIERS: readonly LintTier[] = ['critical', 'warning', 'suggestion']

/** 待确认队列行上的短种类。生命周期「草稿」与节标题「待确认草稿」都不走这里。 */
function draftKindLabel(kind: CardDraft['kind'], t: Messages): string {
  switch (kind) {
    case 'card':
      return t.draftKindCard
    case 'merge':
      return t.draftKindMerge
    case 'status':
      return t.draftKindStatus
  }
}

/** 行内不再展示的目标、分级与策略，留给悬停。 */
function draftRowMeta(draft: CardDraft): string {
  return `${draft.target} · ${draft.classification} · ${draft.policy}`
}

/** 同一 path 的 findings。空 path 是库级组。 */
interface LintGroup {
  readonly path: string
  readonly findings: readonly LintFinding[]
}

/**
 * 按 path 分组。
 *
 * 卡片路径保持首次出现的顺序；空 path 的库级组固定放在最后。
 */
function groupFindings(findings: readonly LintFinding[]): readonly LintGroup[] {
  const paths: string[] = []
  for (const finding of findings) {
    if (!paths.includes(finding.path)) paths.push(finding.path)
  }
  const ordered = [...paths.filter(path => path !== ''), ...paths.filter(path => path === '')]
  return ordered.map(path => ({
    path,
    findings: findings.filter(finding => finding.path === path),
  }))
}

/** 组头计数。为零的档不写。 */
function lintGroupCounts(findings: readonly LintFinding[], t: Messages): string {
  const counts: Record<LintTier, number> = { critical: 0, warning: 0, suggestion: 0 }
  for (const finding of findings) counts[finding.tier] += 1
  const parts: string[] = []
  if (counts.critical > 0) parts.push(`${t.lintStripCritical} ${String(counts.critical)}`)
  if (counts.warning > 0) parts.push(`${t.lintStripWarning} ${String(counts.warning)}`)
  if (counts.suggestion > 0) parts.push(`${t.lintSuggestion} ${String(counts.suggestion)}`)
  return parts.join(' · ')
}

/**
 * 同一张卡（或库级）的 findings。
 *
 * 组头的路径打开卡片；库级没有卡片，标题不可点。
 * critical 与 warning 默认展开，suggestion 默认收起。
 * `read` 为真时整组先收起，并套上淡化。父级用 path 加 read 作 key，
 * 标记翻转时重新挂载，于是收起状态跟着重置。
 */
function LintPathGroup({ path, findings, read, t, onOpenCard, onToggleRead }: {
  readonly path: string
  readonly findings: readonly LintFinding[]
  readonly read: boolean
  readonly t: Messages
  readonly onOpenCard: (path: string) => void
  readonly onToggleRead: (path: string) => void
}): ReactNode {
  const [expanded, setExpanded] = useState(!read)
  const [openTiers, setOpenTiers] = useState<readonly LintTier[]>(['critical', 'warning'])
  const toggleTier = (tier: LintTier): void => {
    setOpenTiers(previous => previous.includes(tier)
      ? previous.filter(item => item !== tier)
      : [...previous, tier])
  }
  return (
    <div
      className="iw-lint-group"
      data-path={path}
      data-read={read ? 'true' : 'false'}
      data-library={path === '' ? 'true' : 'false'}
    >
      <div className="iw-lint-group-bar">
        <button
          type="button"
          className="iw-lint-fold"
          aria-expanded={expanded}
          onClick={() => { setExpanded(value => !value) }}
        >
          <span className="iw-caret">{expanded ? '▼' : '▶'}</span>
        </button>
        {path === '' ? (
          <span className="iw-lint-group-title">{t.lintLibraryWide}</span>
        ) : (
          <button type="button" className="iw-lint-group-title" onClick={() => { onOpenCard(path) }}>
            {path}
          </button>
        )}
        <span className="iw-lint-group-counts">{lintGroupCounts(findings, t)}</span>
        <button
          type="button"
          className="iw-btn iw-btn-quiet iw-lint-mark"
          aria-pressed={read}
          onClick={() => { onToggleRead(path) }}
        >
          {read ? t.lintUnmarkRead : t.lintMarkRead}
        </button>
      </div>
      {!expanded ? null : LINT_TIERS.map(tier => {
        const inTier = findings.filter(finding => finding.tier === tier)
        if (inTier.length === 0) return null
        const isOpen = openTiers.includes(tier)
        return (
          <div key={tier} className="iw-finding-group">
            <button
              type="button"
              className="iw-group-head iw-tier-head iw-finding-group-head"
              data-tier={tier}
              aria-expanded={isOpen}
              onClick={() => { toggleTier(tier) }}
            >
              <span className="iw-caret">{isOpen ? '▼' : '▶'}</span>
              <span>{tier}</span>
              <span className="iw-count">{inTier.length}</span>
            </button>
            {!isOpen ? null : inTier.map((finding, index) => (
              <div key={`${finding.code}-${String(index)}`} className={`iw-finding iw-tier-${finding.tier}`}>
                <span className="iw-finding-head">{`${finding.tier} · ${finding.code}`}</span>
                <span className="iw-finding-message">{finding.message}</span>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

/** The reader pane for one quality-gate report. */
function LintReader({ report, t, busy, readKeys, onToggleRead, onRebuild, onOpenCard }: {
  readonly report: LintReport
  readonly t: Messages
  readonly busy: boolean
  readonly readKeys: ReadonlySet<string>
  readonly onToggleRead: (path: string) => void
  readonly onRebuild: () => void
  readonly onOpenCard: (path: string) => void
}): ReactNode {
  const chips = [
    { label: t.lintScanned, value: report.scanned, tone: '' },
    { label: t.lintCritical, value: report.counts.critical, tone: 'iw-chip-error' },
    { label: t.lintWarning, value: report.counts.warning, tone: 'iw-chip-warn' },
    { label: t.lintSuggestion, value: report.counts.suggestion, tone: '' },
  ]
  const groups = groupFindings(report.findings)
  return (
    <article>
      <h2 className="iw-read-title">{t.lint}</h2>
      <div className="iw-meta">
        <span className={report.verdict === 'pass' ? 'iw-chip iw-chip-ok' : 'iw-chip iw-chip-error'}>
          {report.verdict === 'pass' ? t.lintPass : t.lintFail}
        </span>
        <span className="iw-chip">{t.lintFailOn}<b>{report.failOn}</b></span>
        {chips.map(chip => (
          <span key={chip.label} className={chip.tone === '' ? 'iw-chip' : `iw-chip ${chip.tone}`}>
            {chip.label}<b>{chip.value}</b>
          </span>
        ))}
      </div>
      <div className="iw-actions">
        <button type="button" className="iw-btn" disabled={busy} onClick={onRebuild}>{t.rebuildIndex}</button>
      </div>
      <section>
        <div className="iw-section-title">{t.lintFindings}（{report.findings.length}）</div>
        {report.findings.length === 0 ? (
          <div className="iw-empty">{t.lintEmpty}</div>
        ) : (
          groups.map(group => (
            <LintPathGroup
              key={`${group.path}\u0000${readKeys.has(group.path) ? '1' : '0'}`}
              path={group.path}
              findings={group.findings}
              read={readKeys.has(group.path)}
              t={t}
              onOpenCard={onOpenCard}
              onToggleRead={onToggleRead}
            />
          ))
        )}
      </section>
    </article>
  )
}

/** The reader pane for one report. */
function ReportReader({ document, t }: { readonly document: ReportDocument; readonly t: Messages }): ReactNode {
  return (
    <article>
      <h2 className="iw-read-title">{document.name}</h2>
      <div className="iw-meta"><Chip label={t.reports} value={document.name} /></div>
      <Markdown text={document.text} />
    </article>
  )
}

/**
 * Render the library panel.
 * @param props - the injected host API and the active locale id.
 * @returns the panel.
 */
export function LibraryPanel({ api, localeId }: LibraryPanelProps): ReactNode {
  const t = dictionaryFor(localeId)
  const [tree, setTree] = useState<LibraryTree | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  // Domain groups start collapsed: at 1,137 cards the top level is the map, and
  // the tree shows forty-odd headings instead of every row until one is asked for.
  const [expanded, setExpanded] = useState<readonly string[]>([])
  const [filter, setFilter] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleted, setDeleted] = useState<{ readonly title: string; readonly stripped: number } | null>(null)
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [found, setFound] = useState<SearchResult | null>(null)
  const [retrieval, setRetrieval] = useState<SearchStatus | null>(null)
  const [searching, setSearching] = useState(false)
  const [drafts, setDrafts] = useState<readonly CardDraft[]>([])
  const [landed, setLanded] = useState<{ readonly ids: readonly string[]; readonly summary: string } | null>(null)
  const [lint, setLint] = useState<LintReport | null>(null)
  // 「已阅」只活在这次面板挂载里。键是 path，库级用空字符串。不写 Host、不落盘。
  const [lintRead, setLintRead] = useState<ReadonlySet<string>>(() => new Set())
  // A batch writes one card at a time, so it asks before it starts and then
  // reports how far it got: nine hundred confirmations must not run silently.
  const [confirmingAll, setConfirmingAll] = useState(false)
  const [progress, setProgress] = useState<{ readonly done: number; readonly total: number } | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      setTree(await api.fetchTree())
      setFailed(null)
    } catch (cause) {
      setFailed(describe(cause))
    } finally {
      setBusy(false)
    }
  }, [api])

  const refreshDrafts = useCallback(async (): Promise<void> => {
    try {
      setDrafts(await api.fetchDrafts())
    } catch (cause) {
      setFailed(describe(cause))
    }
  }, [api])

  const refreshLint = useCallback(async (): Promise<void> => {
    try {
      const report = await api.fetchLint('warning')
      setLint(report)
      setSelection(previous => previous?.kind === 'lint' ? { kind: 'lint', report } : previous)
    } catch (cause) {
      setFailed(describe(cause))
    }
  }, [api])

  // 报告换过之后，已经不在报告里的 path 不再保留已阅。还在的键留着。
  useEffect(() => {
    const alive = new Set(lint === null ? [] : lint.findings.map(finding => finding.path))
    setLintRead(previous => {
      let dropped = false
      const next = new Set<string>()
      for (const key of previous) {
        if (alive.has(key)) next.add(key)
        else dropped = true
      }
      return dropped ? next : previous
    })
  }, [lint])

  const toggleLintRead = useCallback((path: string): void => {
    setLintRead(previous => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  /**
   * Read the library again after the notice reported a failure. A success
   * clears the notice through {@link refresh}; a failure reports it again.
   */
  const retryAll = useCallback(async (): Promise<void> => {
    await Promise.all([refresh(), refreshDrafts(), refreshLint()])
  }, [refresh, refreshDrafts, refreshLint])

  useEffect(() => {
    void refresh()
    void refreshDrafts()
    void refreshLint()
  }, [refresh, refreshDrafts, refreshLint])

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        setRetrieval(await api.fetchSearchStatus())
      } catch (cause) {
        setFailed(describe(cause))
      }
    })()
  }, [api])

  const runSearch = useCallback(async (): Promise<void> => {
    const trimmed = query.trim()
    if (trimmed === '') {
      setSubmitted('')
      setFound(null)
      return
    }
    setSearching(true)
    setSubmitted(trimmed)
    try {
      setFound(await api.fetchSearch(trimmed, SEARCH_LIMIT))
      setFailed(null)
    } catch (cause) {
      setFailed(describe(cause))
    } finally {
      setSearching(false)
    }
  }, [api, query])

  const clearSearch = useCallback((): void => {
    setQuery('')
    setSubmitted('')
    setFound(null)
  }, [])

  const openCard = useCallback(async (path: string): Promise<void> => {
    setBusy(true)
    try {
      setSelection({ kind: 'card', document: await api.fetchCard(path) })
      setFailed(null)
    } catch (cause) {
      setFailed(describe(cause))
    } finally {
      setBusy(false)
    }
  }, [api])

  const openReport = useCallback(async (name: string): Promise<void> => {
    setBusy(true)
    try {
      setSelection({ kind: 'report', document: await api.fetchReport(name) })
      setFailed(null)
    } catch (cause) {
      setFailed(describe(cause))
    } finally {
      setBusy(false)
    }
  }, [api])

  const rebuild = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      await api.rebuildIndex()
      await Promise.all([refresh(), refreshLint()])
      setFailed(null)
    } catch (cause) {
      setFailed(describe(cause))
    } finally {
      setBusy(false)
    }
  }, [api, refresh, refreshLint])

  const openLint = useCallback((): void => {
    if (lint !== null) setSelection({ kind: 'lint', report: lint })
  }, [lint])

  const openDraft = useCallback(async (id: string): Promise<void> => {
    setBusy(true)
    try {
      setSelection({ kind: 'draft', view: await api.fetchDraft(id) })
      setFailed(null)
    } catch (cause) {
      setFailed(describe(cause))
    } finally {
      setBusy(false)
    }
  }, [api])

  const confirmSelection = useCallback(async (id: string): Promise<void> => {
    setBusy(true)
    try {
      const done = await api.confirmDraft(id)
      setLanded({ ids: [id], summary: done.path })
      setSelection(null)
      setFailed(null)
      await Promise.all([refresh(), refreshDrafts(), refreshLint()])
    } catch (cause) {
      setFailed(describe(cause))
    } finally {
      setBusy(false)
    }
  }, [api, refresh, refreshDrafts, refreshLint])

  // One request per draft, in the order the list shows: each confirm backs its own
  // card up, so a batch that stops half way leaves every landed card revertible.
  const confirmAll = useCallback(async (): Promise<void> => {
    const ids = drafts.map(draft => draft.id)
    const done: string[] = []
    setConfirmingAll(false)
    setBusy(true)
    setProgress({ done: 0, total: ids.length })
    try {
      for (const id of ids) {
        await api.confirmDraft(id)
        done.push(id)
        setProgress({ done: done.length, total: ids.length })
      }
      setLanded({ ids: done, summary: `${String(done.length)} ${t.batchUnit}` })
      setSelection(null)
      setFailed(null)
      await Promise.all([refresh(), refreshDrafts(), refreshLint()])
    } catch (cause) {
      // The refresh clears the failure banner, so what went wrong is set after it:
      // a batch that stopped half way has to say so and stay revertible.
      // The gate is re-read only after a batch that lands every card.
      await Promise.all([refresh(), refreshDrafts()])
      setLanded(done.length === 0 ? null : { ids: done, summary: `${String(done.length)} ${t.batchUnit}` })
      setFailed(`${describe(cause)}｜${t.batchInterrupted} ${String(done.length)} ${t.batchUnit}`)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }, [api, drafts, refresh, refreshDrafts, refreshLint, t.batchInterrupted, t.batchUnit])

  const discardSelection = useCallback(async (id: string): Promise<void> => {
    setBusy(true)
    try {
      await api.discardDraft(id)
      setSelection(null)
      setFailed(null)
      await refreshDrafts()
    } catch (cause) {
      setFailed(describe(cause))
    } finally {
      setBusy(false)
    }
  }, [api, refreshDrafts])

  const revertLanded = useCallback(async (ids: readonly string[]): Promise<void> => {
    setBusy(true)
    try {
      // Newest first, so the library unwinds in the reverse of the order it landed.
      for (const id of [...ids].reverse()) await api.revertDraft(id)
      setLanded(null)
      setFailed(null)
      await Promise.all([refresh(), refreshDrafts()])
    } catch (cause) {
      setFailed(describe(cause))
    } finally {
      setBusy(false)
    }
  }, [api, refresh, refreshDrafts])

  const toggle = useCallback((key: string): void => {
    setExpanded(previous =>
      previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key])
  }, [])

  // Shift+X shows or collapses the whole tree at once: opening forty groups one at
  // a time to find a single card is what makes a list this size unusable.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.shiftKey || event.key.toLowerCase() !== 'x') return
      setExpanded(previous => previous.length === 0
        ? (tree?.branches ?? []).flatMap(branch => branch.groups.map(group => group.key))
        : [])
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [tree])

  const wiki = useMemo<WikilinkAccess>(
    () => ({ resolve: linkResolver(tree), open: (path: string) => { void openCard(path) } }),
    [tree, openCard],
  )
  const titles = useMemo(() => titlesByPath(tree), [tree])

  /**
   * Delete one card for good. The Host clears the references other cards make to
   * it in the same operation, so the answer says how many there were.
   */
  const deleteSelection = useCallback(async (path: string): Promise<void> => {
    setConfirmingDelete(false)
    setBusy(true)
    try {
      const done = await api.deleteCard(path)
      setDeleted({ title: done.title === '' ? done.path : done.title, stripped: done.stripped.length })
      setSelection(null)
      setFailed(null)
      await Promise.all([refresh(), refreshLint()])
    } catch (cause) {
      setFailed(describe(cause))
    } finally {
      setBusy(false)
    }
  }, [api, refresh, refreshLint])

  const status = tree?.status
  const branches = tree?.branches ?? []
  const reports = status?.reports ?? []
  const selectedPath = selection?.kind === 'card' ? selection.document.path : ''
  const selectedReport = selection?.kind === 'report' ? selection.document.name : ''
  const needle = filter.trim().toLowerCase()
  const matches = needle === ''
    ? []
    : branches.flatMap(branch => branch.groups.flatMap(group => group.cards))
      .filter(card => card.title.toLowerCase().includes(needle))
  const groupCount = branches.reduce((sum, branch) => sum + branch.groups.length, 0)

  return (
    <div className="iw-root">
      <style>{libraryStyles()}</style>
      <header className="iw-head">
        <span className="iw-title">{t.panel}</span>
        {status === undefined ? null : <span className="iw-root-path" title={status.root}>{status.root}</span>}
        <span className="iw-spacer" />
        {retrieval === null ? null : (
          <span className={retrieval.semantic ? 'iw-chip' : 'iw-chip iw-chip-warn'}>
            {t.retrieval}
            <b>{retrieval.semantic ? t.retrievalSemantic : t.retrievalKeyword}</b>
            {retrieval.total > 0 && retrieval.warmed < retrieval.total
              ? <>{t.retrievalWarming}<b>{`${String(retrieval.warmed)}/${String(retrieval.total)}`}</b></>
              : null}
          </span>
        )}
        {busy ? (
          <span className="iw-chip">
            {progress === null
              ? t.loading
              : <>{t.landing}<b>{`${String(progress.done)}/${String(progress.total)}`}</b></>}
          </span>
        ) : null}
        <button type="button" className="iw-btn iw-btn-quiet" disabled={busy} onClick={() => { void refresh() }}>
          {t.refresh}
        </button>
      </header>
      {status === undefined ? null : <StatusStrip status={status} lint={lint} t={t} onOpenLint={openLint} />}
      {failed === null ? null : (
        <div className="iw-error">
          <span className="iw-error-text">{t.failed}：{failed}</span>
          <button type="button" className="iw-btn" onClick={() => { void retryAll() }}>{t.retry}</button>
        </div>
      )}
      {status !== undefined && !status.exists ? (
        <div className="iw-error">{t.rootMissing}：{status.problem}</div>
      ) : null}
      {landed === null ? null : (
        <div className="iw-head iw-banner">
          <span className="iw-chip iw-chip-ok">
            {landed.ids.length === 1 ? t.confirmedBanner : t.batchLanded}<b>{landed.summary}</b>
          </span>
          <span className="iw-root-path">{t.revertable}</span>
          <span className="iw-spacer" />
          <button type="button" className="iw-btn iw-btn-danger" disabled={busy} onClick={() => { void revertLanded(landed.ids) }}>
            {t.revert}
          </button>
        </div>
      )}
      {deleted === null ? null : (
        <div className="iw-head iw-banner">
          <span className="iw-chip iw-chip-error">{t.deleteGone}<b>{deleted.title}</b></span>
          <span className="iw-root-path">{`${String(deleted.stripped)} ${t.deleteStripped}`}</span>
          <span className="iw-spacer" />
          <button type="button" className="iw-btn iw-btn-quiet" onClick={() => { setDeleted(null) }}>
            {t.dismiss}
          </button>
        </div>
      )}
      <div className="iw-body">
        <nav className="iw-tree">
          <div className="iw-tree-pin">
            <div className="iw-search">
              <input
                className="iw-input"
                type="search"
                value={query}
                placeholder={t.searchPlaceholder}
                aria-label={t.search}
                onChange={(event) => { setQuery(event.target.value) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void runSearch()
                }}
              />
              <button type="button" className="iw-btn" disabled={searching} onClick={() => { void runSearch() }}>
                {t.searchRun}
              </button>
              {submitted === '' ? null : (
                <button type="button" className="iw-btn iw-btn-quiet" onClick={clearSearch}>{t.searchClear}</button>
              )}
            </div>
            <div className="iw-filter">
              <input
                className="iw-filter-input"
                type="search"
                value={filter}
                placeholder={t.filterPlaceholder}
                aria-label={t.filterPlaceholder}
                disabled={submitted !== ''}
                aria-describedby={submitted === '' ? undefined : 'iw-filter-unavailable'}
                onChange={(event) => { setFilter(event.target.value) }}
              />
              {submitted === '' ? null : (
                <span id="iw-filter-unavailable" className="iw-filter-unavailable">{t.filterUnavailable}</span>
              )}
            </div>
          </div>
          <div className="iw-tree-scroll">
            {searching ? <div className="iw-searching" role="status">{t.searching}</div> : null}
            {submitted === '' ? (
              <>
                <section className="iw-section">
                  <div className="iw-section-title">{t.drafts}（{drafts.length}）</div>
                  {drafts.length === 0 || !confirmingAll ? null : (
                    <div className="iw-confirm">
                      <span className="iw-confirm-ask">{t.confirmAllAsk}</span>
                      <span className="iw-spacer" />
                      <button type="button" className="iw-btn iw-btn-primary" onClick={() => { void confirmAll() }}>
                        {t.confirmAllYes}
                      </button>
                      <button type="button" className="iw-btn iw-btn-quiet" onClick={() => { setConfirmingAll(false) }}>
                        {t.cancel}
                      </button>
                    </div>
                  )}
                  {drafts.length === 0 ? null : (
                    <div className="iw-actions">
                      <button
                        type="button"
                        className="iw-btn iw-btn-primary"
                        disabled={busy}
                        onClick={() => { setConfirmingAll(true) }}
                      >
                        {t.confirmAll}（{drafts.length}）
                      </button>
                    </div>
                  )}
                  {drafts.length === 0 ? (
                    <div className="iw-empty">{t.draftsEmpty}</div>
                  ) : (
                    drafts.map(draft => (
                      <button
                        key={draft.id}
                        type="button"
                        title={draftRowMeta(draft)}
                        className={selection?.kind === 'draft' && selection.view.draft.id === draft.id
                          ? 'iw-row iw-row-line iw-row-flat iw-row-selected'
                          : 'iw-row iw-row-line iw-row-flat'}
                        onClick={() => { void openDraft(draft.id) }}
                      >
                        <span className="iw-row-title">{draft.title === '' ? draft.target : draft.title}</span>
                        <span className="iw-chip">{draftKindLabel(draft.kind, t)}</span>
                      </button>
                    ))
                  )}
                </section>
                <section className="iw-section">
                  <div className="iw-section-title">{t.lint}</div>
                  {lint === null ? (
                    <div className="iw-empty">{t.loading}</div>
                  ) : (
                    <button
                      type="button"
                      className={selection?.kind === 'lint' ? 'iw-row iw-row-line iw-row-flat iw-row-selected' : 'iw-row iw-row-line iw-row-flat'}
                      onClick={openLint}
                    >
                      <span className="iw-row-title">
                        <span className={`iw-chip ${gateTone(lint)}`}>
                          {lint.verdict === 'pass' ? t.lintPass : t.lintFail}
                        </span>
                      </span>
                      <span className="iw-row-meta">
                        {`${t.lintCritical} ${String(lint.counts.critical)} · ${t.lintWarning} ${String(lint.counts.warning)} · ${t.lintSuggestion} ${String(lint.counts.suggestion)}`}
                      </span>
                    </button>
                  )}
                </section>
                {status !== undefined && status.needsReview.length > 0 ? (
                  <section className="iw-section">
                    <div className="iw-section-title">{t.reviewQueue}（{status.needsReview.length}）</div>
                    {status.needsReview.map(card => (
                      <button
                        key={`review-${card.path}`}
                        type="button"
                        title={card.title}
                        className={card.path === selectedPath ? 'iw-row iw-row-line iw-row-flat iw-row-selected' : 'iw-row iw-row-line iw-row-flat'}
                        onClick={() => { void openCard(card.path) }}
                      >
                        <span className="iw-row-title">{card.title}</span>
                        <span className="iw-row-meta">
                          {CARD_TYPE_LABEL[card.type]}
                          {` · ${t.confidence} ${card.confidence.toFixed(2)}`}
                        </span>
                      </button>
                    ))}
                  </section>
                ) : null}
                <section className="iw-section">
                  <div className="iw-section-title">
                    {t.treeTitle}
                    {needle !== '' ? null : (
                      <span className="iw-section-count">（{groupCount} {t.groups}）</span>
                    )}
                    <span className="iw-chip">{t.expandHint}</span>
                  </div>
                  {branches.length === 0 ? (
                    <div className="iw-empty">{t.cardsEmpty}</div>
                  ) : needle !== '' ? (
                    matches.length === 0 ? (
                      <div className="iw-empty">{t.filterEmpty}</div>
                    ) : (
                      matches.map(card => (
                        <button
                          key={`match-${card.path}`}
                          type="button"
                          title={cardRowTitle(card, t, CARD_TYPE_LABEL[card.type])}
                          className={card.path === selectedPath ? 'iw-row iw-row-line iw-row-flat iw-row-selected' : 'iw-row iw-row-line iw-row-flat'}
                          onClick={() => { void openCard(card.path) }}
                        >
                          <span className="iw-row-title">{card.title}</span>
                          <span className="iw-row-meta">{statusText(card.status, t)}</span>
                        </button>
                      ))
                    )
                  ) : (
                    branches.map(branch => (
                      <div key={branch.type} className="iw-group">
                        <div className="iw-section-title">{branch.label}（{branch.total}）</div>
                        {branch.groups.map(group => {
                          const isCollapsed = !expanded.includes(group.key)
                          return (
                            <div key={group.key}>
                              <button
                                type="button"
                                className="iw-group-head"
                                aria-expanded={!isCollapsed}
                                onClick={() => { toggle(group.key) }}
                              >
                                <span className="iw-caret">{isCollapsed ? '▶' : '▼'}</span>
                                <span>{group.label}</span>
                                <span className="iw-count">{group.cards.length}</span>
                              </button>
                              {isCollapsed ? null : group.cards.map(card => (
                                <button
                                  key={card.path}
                                  type="button"
                                  title={cardRowTitle(card, t)}
                                  className={card.path === selectedPath ? 'iw-row iw-row-line iw-row-selected' : 'iw-row iw-row-line'}
                                  onClick={() => { void openCard(card.path) }}
                                >
                                  <span className="iw-row-title">{card.title}</span>
                                  <span className="iw-row-meta">{statusText(card.status, t)}</span>
                                </button>
                              ))}
                            </div>
                          )
                        })}
                      </div>
                    ))
                  )}
                </section>
                <section className="iw-section">
                  <div className="iw-section-title">{t.reports}（{reports.length}）</div>
                  {reports.length === 0 ? (
                    <div className="iw-empty">{t.reportsEmpty}</div>
                  ) : (
                    reports.map(name => (
                      <button
                        key={name}
                        type="button"
                        title={name}
                        className={name === selectedReport ? 'iw-row iw-row-line iw-row-flat iw-row-selected' : 'iw-row iw-row-line iw-row-flat'}
                        onClick={() => { void openReport(name) }}
                      >
                        <span className="iw-row-title">{name}</span>
                      </button>
                    ))
                  )}
                </section>
              </>
            ) : (
              <section className="iw-section">
                <div className="iw-section-title">
                  {t.searchResults}（{found === null ? 0 : found.hits.length}）
                  {found === null ? '' : ` · ${modeLabel(found.mode, t)} · ${t.scanned} ${String(found.scanned)}`}
                  {found === null || found.deprecated === 0 ? '' : ` · ${t.statusDeprecated} ${String(found.deprecated)}`}
                  {found === null || found.duplicates === 0 ? '' : ` · ${t.nearDuplicates} ${String(found.duplicates)}`}
                </div>
                {found !== null && found.degraded !== '' ? <div className="iw-notice">{found.degraded}</div> : null}
                {found !== null && found.hits.length === 0 ? <div className="iw-empty">{t.searchNoHits}</div> : null}
                {(found === null ? [] : found.hits).map(hit => (
                  <HitRow
                    key={hit.path}
                    hit={hit}
                    t={t}
                    selected={hit.path === selectedPath}
                    onOpen={(path) => { void openCard(path) }}
                  />
                ))}
              </section>
            )}
          </div>
        </nav>
        <main className="iw-read">
          {selection === null ? (
            <div className="iw-hint">
              <div>{t.pick}</div>
              <div>{t.pickHint}</div>
            </div>
          ) : selection.kind === 'card' ? (
            <CardReader
              document={selection.document}
              t={t}
              busy={busy}
              wiki={wiki}
              confirming={confirmingDelete}
              onAskDelete={() => { setConfirmingDelete(true) }}
              onCancelDelete={() => { setConfirmingDelete(false) }}
              onDelete={() => { void deleteSelection(selection.document.path) }}
            />
          ) : selection.kind === 'report' ? (
            <ReportReader document={selection.document} t={t} />
          ) : selection.kind === 'lint' ? (
            <LintReader
              report={selection.report}
              t={t}
              busy={busy}
              readKeys={lintRead}
              onToggleRead={toggleLintRead}
              onRebuild={() => { void rebuild() }}
              onOpenCard={(path) => { void openCard(path) }}
            />
          ) : (
            <DraftReader
              key={selection.view.draft.id}
              view={selection.view}
              titles={titles}
              t={t}
              busy={busy}
              onConfirm={() => { void confirmSelection(selection.view.draft.id) }}
              onDiscard={() => { void discardSelection(selection.view.draft.id) }}
              onOpenCard={(path) => { void openCard(path) }}
            />
          )}
        </main>
      </div>
    </div>
  )
}
