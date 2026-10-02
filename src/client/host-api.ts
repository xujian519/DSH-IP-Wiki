/**
 * The Client's access to the library routes.
 *
 * One place builds every request, so the guard header and the route prefix cannot
 * drift between the calls, and the injected `fetch` keeps the whole module
 * testable without a browser global.
 * @module dsh-ip-wiki/client/host-api
 */
import type {
  CardDocument,
  DeleteResult,
  LibraryStatus,
  LibraryTree,
  ReportDocument,
  SearchResult,
  SearchStatus,
} from '../shared/card'
import type { IndexBuild } from '../shared/card'
import type { CardDraft, ConfirmResult, DraftView, RevertResult } from '../host/drafts'
import type { LintReport, LintTier } from '../host/lint'
import type { Fetcher as SharedFetcher } from '../shared/wire'
import {
  CARD_DELETE_URL,
  DRAFTS_URL,
  DRAFT_CONFIRM_URL,
  DRAFT_DISCARD_URL,
  DRAFT_REVERT_URL,
  GUARD_HEADER,
  REPORTS_URL,
  SEARCH_STATUS_URL,
  STATUS_URL,
  TREE_URL,
  cardUrl,
  draftUrl,
  INDEX_REBUILD_URL,
  lintUrl,
  reportUrl,
  searchUrl,
} from '../shared/wire'
import {
  parseCardDocumentPayload,
  parseConfirmResult,
  parseDeleteResult,
  parseDraftList,
  parseDraftView,
  parseLibraryTree,
  parseIndexBuild,
  parseLintReport,
  parseReportDocument,
  parseReportList,
  parseRevertResult,
  parseSearchResult,
  parseSearchStatus,
  parseStatus,
} from '../shared/parse'

/** The `fetch` implementation this module calls, shared with the Host half. */
export type Fetcher = SharedFetcher

/** What the panel calls. */
export interface HostApi {
  /** Read the tree and status strip. */
  fetchTree(): Promise<LibraryTree>
  /** Read the status strip alone. */
  fetchStatus(): Promise<LibraryStatus>
  /** Read one card's document. */
  fetchCard(path: string): Promise<CardDocument>
  /** Read one report's text. */
  fetchReport(name: string): Promise<ReportDocument>
  /** Read the report file names. */
  fetchReports(): Promise<string[]>
  /**
   * Search the library.
   * @param query - the query text.
   * @param limit - the greatest number of hits to ask for.
   * @returns the hits and the stage that ordered them.
   */
  fetchSearch(query: string, limit: number): Promise<SearchResult>
  /** Read whether semantic retrieval is available. */
  fetchSearchStatus(): Promise<SearchStatus>
  /**
   * Rebuild the derived card index.
   * @returns how many cards it now describes.
   */
  rebuildIndex(): Promise<IndexBuild>
  /**
   * Run the quality gate.
   * @param failOn - the tier the gate should fail on.
   * @returns the report.
   */
  fetchLint(failOn: LintTier): Promise<LintReport>
  /** Read the pending drafts. */
  fetchDrafts(): Promise<CardDraft[]>
  /**
   * Read one draft with the difference it would make.
   * @param id - the draft id.
   * @returns the view.
   */
  fetchDraft(id: string): Promise<DraftView>
  /**
   * Land one draft's card.
   * @param id - the draft id.
   * @returns where the card landed and what the write did.
   */
  confirmDraft(id: string): Promise<ConfirmResult>
  /**
   * Set one draft aside.
   * @param id - the draft id.
   */
  discardDraft(id: string): Promise<void>
  /**
   * Undo one confirmed draft.
   * @param id - the draft id.
   * @returns what the revert did.
   */
  revertDraft(id: string): Promise<RevertResult>
  /**
   * Delete one card for good, together with the references other cards make to it.
   * @param path - the card's library-relative path.
   * @returns the deleted card, the cards that lost a reference, and the new count.
   */
  deleteCard(path: string): Promise<DeleteResult>
}

/** The error message a failed response carries, when it carries one. */
function messageOf(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined
  const error = (payload as Record<string, unknown>)['error']
  return typeof error === 'string' ? error : undefined
}

/**
 * Build the Client's access to the library routes.
 * @param fetcher - the `fetch` implementation to use.
 * @returns the API the panel calls.
 */
export function createHostApi(fetcher: Fetcher): HostApi {
  async function request(url: string, init: {
    readonly method?: string
    readonly headers?: Record<string, string>
    readonly body?: string
  }): Promise<unknown> {
    const response = await fetcher(url, init)
    const payload = await response.json().catch(() => undefined)
    if (!response.ok) {
      throw new Error(messageOf(payload) ?? `HTTP ${String(response.status)}`)
    }
    return payload
  }
  async function get(url: string): Promise<unknown> {
    return request(url, { headers: { [GUARD_HEADER]: '1' } })
  }
  async function send(url: string, body: Readonly<Record<string, string>>): Promise<unknown> {
    return request(url, {
      method: 'POST',
      headers: { [GUARD_HEADER]: '1', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }
  async function post(url: string): Promise<unknown> {
    return request(url, {
      method: 'POST',
      headers: { [GUARD_HEADER]: '1', 'content-type': 'application/json' },
      body: '{}',
    })
  }
  return {
    async fetchTree() {
      return parseLibraryTree(await get(TREE_URL))
    },
    async fetchStatus() {
      return parseStatus(await get(STATUS_URL))
    },
    async fetchCard(path) {
      return parseCardDocumentPayload(await get(cardUrl(path)))
    },
    async fetchReport(name) {
      return parseReportDocument(await get(reportUrl(name)))
    },
    async fetchReports() {
      return parseReportList(await get(REPORTS_URL))
    },
    async fetchSearch(query, limit) {
      return parseSearchResult(await get(searchUrl(query, limit)))
    },
    async fetchSearchStatus() {
      return parseSearchStatus(await get(SEARCH_STATUS_URL))
    },
    async rebuildIndex() {
      return parseIndexBuild(await post(INDEX_REBUILD_URL))
    },
    async fetchLint(failOn) {
      return parseLintReport(await get(lintUrl(failOn)))
    },
    async fetchDrafts() {
      return parseDraftList(await get(DRAFTS_URL))
    },
    async fetchDraft(id) {
      return parseDraftView(await get(draftUrl(id)))
    },
    async confirmDraft(id) {
      return parseConfirmResult(await send(DRAFT_CONFIRM_URL, { id }))
    },
    async discardDraft(id) {
      await send(DRAFT_DISCARD_URL, { id })
    },
    async revertDraft(id) {
      return parseRevertResult(await send(DRAFT_REVERT_URL, { id }))
    },
    async deleteCard(path) {
      return parseDeleteResult(await send(CARD_DELETE_URL, { path }))
    },
  }
}
