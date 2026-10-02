/**
 * The wire facts both halves must agree on.
 *
 * Both entry points import these rather than declaring their own copies: a
 * header name or prefix that drifts between the Host routes and the Client's
 * fetch is a silently broken panel, and one shared constant cannot drift.
 * @module dsh-ip-wiki/shared/wire
 */

/** Request header every library route requires. */
export const GUARD_HEADER = 'x-dsh-ip-wiki'

/** Route prefix owned by this plugin. */
export const ROUTE_PREFIX = '/dsh-ip-wiki'

/** Absolute URL of the status route. */
export const STATUS_URL = `${ROUTE_PREFIX}/status`

/** Absolute URL of the tree route. */
export const TREE_URL = `${ROUTE_PREFIX}/tree`

/** Absolute URL of the reports route. */
export const REPORTS_URL = `${ROUTE_PREFIX}/reports`

/**
 * Absolute URL of the card route.
 * @param path - the card's library-relative path.
 * @returns the URL to fetch.
 */
export function cardUrl(path: string): string {
  return `${ROUTE_PREFIX}/card?path=${encodeURIComponent(path)}`
}

/**
 * Absolute URL of the report route.
 * @param name - the report's file name.
 * @returns the URL to fetch.
 */
export function reportUrl(name: string): string {
  return `${ROUTE_PREFIX}/report?name=${encodeURIComponent(name)}`
}

/**
 * Absolute URL of the search route.
 * @param query - the search text.
 * @param limit - the greatest number of hits to ask for.
 * @returns the URL to fetch.
 */
export function searchUrl(query: string, limit: number): string {
  return `${ROUTE_PREFIX}/search?q=${encodeURIComponent(query)}&limit=${String(limit)}`
}

/** Absolute URL of the retrieval-status route. */
export const SEARCH_STATUS_URL = `${ROUTE_PREFIX}/search-status`

/**
 * Absolute URL of the quality-gate route.
 * @param failOn - the tier the gate should fail on.
 * @returns the URL to fetch.
 */
export function lintUrl(failOn: string): string {
  return `${ROUTE_PREFIX}/lint?failOn=${encodeURIComponent(failOn)}`
}

/** Absolute URL of the index-rebuild route (a write). */
export const INDEX_REBUILD_URL = `${ROUTE_PREFIX}/index/rebuild`

/** Absolute URL of the pending-drafts route. */
export const DRAFTS_URL = `${ROUTE_PREFIX}/drafts`

/** Absolute URL of the draft-confirm route. */
export const DRAFT_CONFIRM_URL = `${ROUTE_PREFIX}/draft/confirm`

/** Absolute URL of the draft-discard route. */
export const DRAFT_DISCARD_URL = `${ROUTE_PREFIX}/draft/discard`

/** Absolute URL of the draft-revert route. */
export const DRAFT_REVERT_URL = `${ROUTE_PREFIX}/draft/revert`

/**
 * Absolute URL of the single-draft route.
 * @param id - the draft id.
 * @returns the URL to fetch.
 */
export function draftUrl(id: string): string {
  return `${ROUTE_PREFIX}/draft?id=${encodeURIComponent(id)}`
}

/** Absolute URL of the card-delete route (a write, and the only one that cannot be undone). */
export const CARD_DELETE_URL = `${ROUTE_PREFIX}/card/delete`

/** The subset of `fetch` both halves use, so a double has one shape to satisfy. */
export type Fetcher = (
  url: string,
  init: {
    readonly method?: string
    readonly headers?: Record<string, string>
    readonly body?: string
    readonly signal?: AbortSignal
  },
) => Promise<{
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}>
