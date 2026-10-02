/**
 * The IP knowledge library panel.
 *
 * One screen holds everything the card library has: the status strip that says
 * where the library is and whether its derived index agrees with the cards, the
 * tree that groups cards by kind and domain beside the report list, and the reader
 * that renders the selected card, report, or pending draft.
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
import type { LintReport, LintTier } from '../host/lint'
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

/** The status strip: what the library holds and whether its derived index agrees. */
function StatusStrip({ status, t }: { readonly status: LibraryStatus; readonly t: Messages }): ReactNode {
  const drift = driftOf(status.indexDrift, t)
  const unconfirmed = status.counts.byStatus['draft'] ?? 0
  const confirmed = status.counts.byStatus['confirmed'] ?? 0
  return (
    <header className="iw-head iw-status">
      <Chip label={t.cards} value={status.counts.total} />
      {Object.entries(status.counts.byType).map(([type, count]) => (
        <Chip key={type} label={CARD_TYPE_LABEL[type as keyof typeof CARD_TYPE_LABEL] ?? type} value={count} />
      ))}
      {unconfirmed === 0 ? null : <Chip label={t.unconfirmed} value={unconfirmed} tone="iw-chip-warn" />}
      {confirmed === 0 ? null : <Chip label={t.statusConfirmed} value={confirmed} tone="iw-chip-ok" />}
      <Chip label={t.index} value={status.indexGeneratedAt ?? t.indexMissing} />
      <span className={`iw-chip ${drift.tone}`}>{drift.text}</span>
      <Chip label={t.reports} value={status.reports.length} />
      {status.needsReview.length === 0 ? null : (
        <Chip label={t.reviewQueue} value={status.needsReview.length} tone="iw-chip-warn" />
      )}
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
  return (
    <article>
      <h2 className="iw-read-title">{document.title}</h2>
      <div className="iw-meta">
        <Chip label={t.type} value={CARD_TYPE_LABEL[document.type]} />
        <Chip label={t.domain} value={document.domainL2} />
        {document.concept === '' ? null : <Chip label={t.concept} value={document.concept} />}
        <Chip label={t.status} value={statusText(document.status, t)} />
        {document.needsReview ? <Chip label={t.needsReview} value="" tone="iw-chip-warn" /> : null}
        {document.supersededBy === '' ? null : <Chip label={t.supersededBy} value={document.supersededBy} tone="iw-chip-warn" />}
      </div>
      <div className="iw-read-actions">
        <button type="button" className="iw-btn iw-btn-danger" disabled={busy} onClick={onAskDelete}>
          {t.deleteCard}
        </button>
      </div>
      {!confirming ? null : (
        <div className="iw-confirm">
          <span className="iw-confirm-ask">{t.deleteCardAsk}</span>
          <span className="iw-spacer" />
          <button type="button" className="iw-btn iw-btn-danger" onClick={onDelete}>{t.deleteCardYes}</button>
          <button type="button" className="iw-btn iw-btn-quiet" onClick={onCancelDelete}>{t.cancel}</button>
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
      {document.relatedConcepts.length === 0 ? null : (
        <div className="iw-related">
          <span className="iw-section-title">{t.related}</span>
          {document.relatedConcepts.map(name => {
            const path = wiki.resolve(name)
            return path === undefined
              ? <span key={name} className="iw-wikilink">{name}</span>
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
      )}
      {headings.length < 2 ? null : (
        <nav className="iw-toc">
          <div className="iw-section-title">{t.toc}</div>
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

/** One search hit, with the excerpt and the provenance that make it checkable. */
function HitRow({ hit, t, selected, onOpen }: {
  readonly hit: SearchHit
  readonly t: Messages
  readonly selected: boolean
  readonly onOpen: (path: string) => void
}): ReactNode {
  const provenance = [...hit.lawRefs, hit.sourcePath].filter(part => part !== '')
  return (
    <button
      type="button"
      className={selected ? 'iw-row iw-row-flat iw-row-selected' : 'iw-row iw-row-flat'}
      onClick={() => { onOpen(hit.path) }}
    >
      <span className="iw-row-title">{hit.title}</span>
      <span className="iw-row-meta">
        {CARD_TYPE_LABEL[hit.type]}
        {` · ${hit.domainL2}`}
        {` · ${hit.matched.map(stage => modeLabel(stage, t)).join(' + ')}`}
        {` · ${t.score} ${hit.score.toFixed(3)}`}
      </span>
      <span className="iw-snippet">{hit.snippet}</span>
      {provenance.length === 0 ? null : (
        <span className="iw-row-meta">{t.provenance}：{provenance.join(' · ')}</span>
      )}
    </button>
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

/** The reader pane for one draft: what it would change, and the two decisions. */
function DraftReader({ view, t, busy, onConfirm, onDiscard, onOpenCard }: {
  readonly view: DraftView
  readonly t: Messages
  readonly busy: boolean
  readonly onConfirm: () => void
  readonly onDiscard: () => void
  readonly onOpenCard: (path: string) => void
}): ReactNode {
  const draft = view.draft
  return (
    <article>
      <h2 className="iw-read-title">{draft.title === '' ? draft.target : draft.title}</h2>
      <div className="iw-meta">
        {draft.kind === 'merge' ? <Chip label={t.merge} value={String(draft.supersedes.length)} tone="iw-chip-warn" /> : null}
        {draft.kind === 'status' ? <Chip label={t.statusConfirm} value="" tone="iw-chip-warn" /> : null}
        <Chip label={t.type} value={CARD_TYPE_LABEL[draft.type]} />
        <span className="iw-chip">{t.draftTarget}<b>{draft.target}</b></span>
        <span className={draft.policy === 'local-only' ? 'iw-chip iw-chip-warn' : 'iw-chip'}>
          {t.draftPolicy}<b>{draft.policy === 'local-only' ? t.draftLocalOnly : draft.policy}</b>
        </span>
        <span className="iw-chip">{t.draftOrigin}<b>{`${draft.classification} / ${draft.generatedBy}`}</b></span>
        <span className="iw-chip">{view.existing ? t.willReplace : t.willCreate}</span>
        <span className="iw-chip">{t.diffTitle}<b>{`+${String(view.counts.added)} / -${String(view.counts.removed)}`}</b></span>
      </div>
      {draft.note === '' ? null : <div className="iw-hint">{draft.note}</div>}
      {draft.sourceRef === '' ? null : <div className="iw-hint">{`${t.source}：${draft.sourceRef}`}</div>}
      {draft.supersedes.length === 0 ? null : (
        <section>
          <div className="iw-section-title">{t.mergeAbsorb}（{draft.supersedes.length}）</div>
          {draft.supersedes.map(path => (
            <button
              key={path}
              type="button"
              title={path}
              className="iw-row iw-row-line iw-row-flat"
              onClick={() => { onOpenCard(path) }}
            >
              <span className="iw-row-title">{path}</span>
            </button>
          ))}
          <div className="iw-hint">{t.mergeNote}</div>
        </section>
      )}
      <div className="iw-actions">
        <button type="button" className="iw-btn iw-btn-primary" disabled={busy} onClick={onConfirm}>{t.confirm}</button>
        <button type="button" className="iw-btn iw-btn-danger" disabled={busy} onClick={onDiscard}>{t.discard}</button>
      </div>
      <DiffView diff={view.diff} t={t} />
    </article>
  )
}

/** The gate's tiers, in the order a reviewer reads them. */
const LINT_TIERS: readonly LintTier[] = ['critical', 'warning', 'suggestion']

/** The reader pane for one quality-gate report. */
function LintReader({ report, t, busy, onRebuild }: {
  readonly report: LintReport
  readonly t: Messages
  readonly busy: boolean
  readonly onRebuild: () => void
}): ReactNode {
  // A large library reports hundreds of the least serious findings, so the tiers
  // are folded: the two that need a decision start open, the bulk starts closed.
  const [open, setOpen] = useState<readonly LintTier[]>(['critical', 'warning'])
  const toggleTier = (tier: LintTier): void => {
    setOpen(previous => previous.includes(tier) ? previous.filter(item => item !== tier) : [...previous, tier])
  }
  const chips = [
    { label: t.lintScanned, value: report.scanned, tone: '' },
    { label: t.lintCritical, value: report.counts.critical, tone: 'iw-chip-error' },
    { label: t.lintWarning, value: report.counts.warning, tone: 'iw-chip-warn' },
    { label: t.lintSuggestion, value: report.counts.suggestion, tone: '' },
  ]
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
          LINT_TIERS.map(tier => {
            const inTier = report.findings.filter(finding => finding.tier === tier)
            const isOpen = open.includes(tier)
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
                  <div key={`f${tier}-${String(index)}`} className={`iw-finding iw-tier-${finding.tier}`}>
                    <span className="iw-finding-head">{`${finding.tier} · ${finding.code}`}</span>
                    <span className="iw-finding-path">{finding.path === '' ? t.lintLibraryWide : finding.path}</span>
                    <span className="iw-finding-message">{finding.message}</span>
                  </div>
                ))}
              </div>
            )
          })
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
      setLint(await api.fetchLint('warning'))
    } catch (cause) {
      setFailed(describe(cause))
    }
  }, [api])

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
      await Promise.all([refresh(), refreshDrafts()])
    } catch (cause) {
      setFailed(describe(cause))
    } finally {
      setBusy(false)
    }
  }, [api, refresh, refreshDrafts])

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
      await Promise.all([refresh(), refreshDrafts()])
    } catch (cause) {
      // The refresh clears the failure banner, so what went wrong is set after it:
      // a batch that stopped half way has to say so and stay revertible.
      await Promise.all([refresh(), refreshDrafts()])
      setLanded(done.length === 0 ? null : { ids: done, summary: `${String(done.length)} ${t.batchUnit}` })
      setFailed(`${describe(cause)}｜${t.batchInterrupted} ${String(done.length)} ${t.batchUnit}`)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }, [api, drafts, refresh, refreshDrafts, t.batchInterrupted, t.batchUnit])

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
      {status === undefined ? null : <StatusStrip status={status} t={t} />}
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
          {searching ? <div className="iw-empty">{t.searching}</div> : null}
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
                      title={draft.target}
                      className={selection?.kind === 'draft' && selection.view.draft.id === draft.id
                        ? 'iw-row iw-row-line iw-row-flat iw-row-selected'
                        : 'iw-row iw-row-line iw-row-flat'}
                      onClick={() => { void openDraft(draft.id) }}
                    >
                      <span className="iw-row-title">{draft.title === '' ? draft.target : draft.title}</span>
                      <span className="iw-row-meta">
                        {`${draft.kind === 'status' ? `${t.statusConfirm} · ` : ''}${draft.target} · ${draft.classification} · ${draft.policy}`}
                      </span>
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
                    <span className="iw-row-title">{lint.verdict === 'pass' ? `✅ ${t.lintPass}` : `❌ ${t.lintFail}`}</span>
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
                  <span className="iw-chip">{t.expandHint}</span>
                </div>
                <div className="iw-filter">
                  <input
                    className="iw-filter-input"
                    type="search"
                    value={filter}
                    placeholder={t.filterPlaceholder}
                    aria-label={t.filterPlaceholder}
                    onChange={(event) => { setFilter(event.target.value) }}
                  />
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
                        title={card.title}
                        className={card.path === selectedPath ? 'iw-row iw-row-line iw-row-flat iw-row-selected' : 'iw-row iw-row-line iw-row-flat'}
                        onClick={() => { void openCard(card.path) }}
                      >
                        <span className="iw-row-title">{card.title}</span>
                        <span className="iw-row-meta">{CARD_TYPE_LABEL[card.type]}</span>
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
                                title={card.title}
                                className={card.path === selectedPath ? 'iw-row iw-row-line iw-row-selected' : 'iw-row iw-row-line'}
                                onClick={() => { void openCard(card.path) }}
                              >
                                <span className="iw-row-title">{card.title}</span>
                                <span className="iw-row-meta">
                                  {statusText(card.status, t)}
                                  {card.concept === '' ? '' : ` · ${card.concept}`}
                                  {card.relatedCount === 0 ? '' : ` · ${t.related} ${String(card.relatedCount)}`}
                                </span>
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
                <div className="iw-section-title">{t.reports}</div>
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
              onRebuild={() => { void rebuild() }}
            />
          ) : (
            <DraftReader
              view={selection.view}
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
