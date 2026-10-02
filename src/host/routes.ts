/**
 * HTTP routes of the IP knowledge library.
 *
 * The routes live outside the `/api` channel, so they carry their own guard: a
 * required request header, which a cross-origin form or image request cannot set
 * without a preflight this plugin never answers, plus an origin check on browsers
 * that send `Sec-Fetch-Site`.
 *
 * Reading routes answer GET. Writing is four POST routes: confirm, discard, and
 * revert a draft, plus the permanent deletion of one card. The draft routes never
 * touch a card except through files they back up first, so every one of them can
 * be undone; deleting a card is the single write that cannot, and the Client asks
 * before it issues one.
 * @module dsh-ip-wiki/host/routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DeleteResult, SearchResult, SearchStatus } from '../shared/card'
import { GUARD_HEADER, ROUTE_PREFIX } from '../shared/wire'
import type { CardDraft, ConfirmResult, DraftView, RevertResult } from './drafts'
import type { IndexBuildResult } from './index-file'
import { asTier, type LintReport, type LintTier } from './lint'
import { listReports, readCard, readReport, readStatus, readTree } from './library'

/** Largest accepted request body. */
const MAX_BODY_BYTES = 64 * 1024

/** The route that rebuilds the derived index; it takes no id. */
const INDEX_REBUILD = '/index/rebuild'

/** The route that deletes one card for good; it takes a path, not a draft id. */
const CARD_DELETE = '/card/delete'

/** The draft operations the POST routes answer. */
const WRITE_ROUTES: Readonly<Record<string, 'confirm' | 'discard' | 'revert'>> = {
  '/draft/confirm': 'confirm',
  '/draft/discard': 'discard',
  '/draft/revert': 'revert',
}

/** Hits a search returns when the caller names no limit. */
const DEFAULT_LIMIT = 8

/** Greatest number of hits a search returns. */
const MAX_LIMIT = 50

/** What the routes need from the plugin. */
export interface RouteDeps {
  /** Absolute library root the reader opens. */
  readonly libraryRoot: string
  /**
   * Run one search.
   * @param query - the query text.
   * @param limit - the greatest number of hits to return.
   * @returns the hits and the stage that ordered them.
   */
  readonly search: (query: string, limit: number) => Promise<SearchResult>
  /**
   * Report retrieval availability.
   * @returns whether the semantic stages can run, and why not when they cannot.
   */
  readonly searchStatus: () => Promise<SearchStatus>
  /**
   * Run the quality gate.
   * @param failOn - the tier the caller is willing to fail on.
   * @returns the report.
   */
  readonly lint: (failOn: LintTier) => Promise<LintReport>
  /**
   * Write the index the cards on disk imply.
   * @returns what was written.
   */
  readonly rebuildIndex: () => Promise<IndexBuildResult>
  /** What the draft routes do; every revertible write in the plugin goes through this. */
  readonly drafts: {
    /** Pending drafts, oldest first. */
    list(): Promise<CardDraft[]>
    /** One draft with what it would change. */
    view(id: string): Promise<DraftView | undefined>
    /** Land one draft's card. */
    confirm(id: string): Promise<ConfirmResult>
    /** Set one draft aside. */
    discard(id: string): Promise<void>
    /** Undo one confirmed draft. */
    revert(id: string): Promise<RevertResult>
  }
  /**
   * Delete one card, and the references other cards make to it. The only write
   * here that cannot be undone.
   * @param path - the card's library-relative path.
   * @returns what the deletion removed.
   */
  readonly deleteCard: (path: string) => Promise<DeleteResult>
}

/** Read a request's JSON body, with a size ceiling. */
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error(`request body exceeds ${String(MAX_BODY_BYTES)} bytes`)
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return {}
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('request body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

/** The `id` a write route needs, or `undefined` when the body carries none. */
function idOf(body: Record<string, unknown>): string | undefined {
  const id = body['id']
  return typeof id === 'string' && id !== '' ? id : undefined
}

/** Answer 405 unless the request uses the one method a route answers. */
function requireMethod(req: IncomingMessage, res: ServerResponse, method: 'GET' | 'POST'): boolean {
  if (req.method === method) return true
  sendJson(res, 405, { error: `${req.method ?? 'request'} is not allowed on this route; ${method} is` })
  return false
}

/**
 * Read a bounded integer query parameter.
 * @param raw - the parameter as it arrived, or `null` when absent.
 * @param fallback - the value to use when the parameter is absent or unusable.
 * @returns an integer within `[1, MAX_LIMIT]`.
 */
export function boundedLimit(raw: string | null, fallback: number): number {
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(parsed, MAX_LIMIT)
}

/** Write one JSON response. */
function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** Whether a browser's own origin signal permits this request. */
function sameOrigin(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site']
  if (site === undefined) return true
  // A repeated header arrives as a list; flattening it keeps every such request
  // out of the two accepted values, which is the safe direction.
  const value = String(site)
  return value === 'same-origin' || value === 'none'
}

/**
 * Build the prefix handler for the plugin's routes.
 * @param deps - the library root every request reads.
 * @returns the handler to register on the Web server.
 */
export function createHandler(deps: RouteDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.headers[GUARD_HEADER] === undefined) {
      sendJson(res, 403, { error: `missing ${GUARD_HEADER} request header` })
      return
    }
    if (!sameOrigin(req)) {
      sendJson(res, 403, { error: 'cross-site request refused' })
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const route = url.pathname.startsWith(ROUTE_PREFIX)
      ? url.pathname.slice(ROUTE_PREFIX.length)
      : ''
    const root = deps.libraryRoot
    if (route === INDEX_REBUILD) {
      if (!requireMethod(req, res, 'POST')) return
      try {
        sendJson(res, 200, await deps.rebuildIndex())
        return
      } catch (cause) {
        sendJson(res, 400, { error: cause instanceof Error ? cause.message : String(cause) })
        return
      }
    }
    const write = WRITE_ROUTES[route]
    if (write !== undefined) {      if (!requireMethod(req, res, 'POST')) return
      try {
        const id = idOf(await readBody(req))
        if (id === undefined) {
          sendJson(res, 400, { error: 'id is required' })
          return
        }
        if (write === 'confirm') sendJson(res, 200, await deps.drafts.confirm(id))
        else if (write === 'discard') {
          await deps.drafts.discard(id)
          sendJson(res, 200, { ok: true })
        } else sendJson(res, 200, await deps.drafts.revert(id))
        return
      } catch (cause) {
        sendJson(res, 400, { error: cause instanceof Error ? cause.message : String(cause) })
        return
      }
    }
    if (route === CARD_DELETE) {
      if (!requireMethod(req, res, 'POST')) return
      try {
        const path = (await readBody(req))['path']
        if (typeof path !== 'string' || path === '') {
          sendJson(res, 400, { error: 'path is required' })
          return
        }
        sendJson(res, 200, await deps.deleteCard(path))
        return
      } catch (cause) {
        sendJson(res, 400, { error: cause instanceof Error ? cause.message : String(cause) })
        return
      }
    }
    if (!requireMethod(req, res, 'GET')) return
    switch (route) {
      case '/status': {
        sendJson(res, 200, await readStatus(root))
        return
      }
      case '/tree': {
        sendJson(res, 200, await readTree(root))
        return
      }
      case '/card': {
        const path = url.searchParams.get('path') ?? ''
        const card = await readCard(root, path)
        if (card === undefined) {
          sendJson(res, 404, { error: `no card at ${path}` })
          return
        }
        sendJson(res, 200, card)
        return
      }
      case '/reports': {
        sendJson(res, 200, { reports: await listReports(root) })
        return
      }
      case '/report': {
        const name = url.searchParams.get('name') ?? ''
        const report = await readReport(root, name)
        if (report === undefined) {
          sendJson(res, 404, { error: `no report at ${name}` })
          return
        }
        sendJson(res, 200, report)
        return
      }
      case '/search': {
        const query = url.searchParams.get('q') ?? ''
        const limit = boundedLimit(url.searchParams.get('limit'), DEFAULT_LIMIT)
        sendJson(res, 200, await deps.search(query, limit))
        return
      }
      case '/search-status': {
        sendJson(res, 200, await deps.searchStatus())
        return
      }
      case '/lint': {
        sendJson(res, 200, await deps.lint(asTier(url.searchParams.get('failOn') ?? undefined, 'warning')))
        return
      }
      case '/drafts': {
        sendJson(res, 200, { drafts: await deps.drafts.list() })
        return
      }
      case '/draft': {
        const id = url.searchParams.get('id') ?? ''
        const view = await deps.drafts.view(id)
        if (view === undefined) {
          sendJson(res, 404, { error: `no draft ${id}` })
          return
        }
        sendJson(res, 200, view)
        return
      }
      default: {
        sendJson(res, 404, { error: `unknown route ${ROUTE_PREFIX}${route}` })
      }
    }
  }
}
