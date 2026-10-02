/** The library routes over a real socket: the guard, the methods, and the payloads. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHandler, boundedLimit, type RouteDeps } from '../src/host/routes'
import { GUARD_HEADER } from '../src/shared/wire'
import { makeLibrary, type FixtureLibrary } from './fixtures'

/** Set by one test to make the rebuild route fail, and another to fail with a plain value. */
let failingIndex = false
let failingIndexWithString = false

let server: Server
let base = ''
let fixture: FixtureLibrary

/**
 * Route deps over one fixture.
 * @param root - the library root to read.
 * @returns deps whose search answers a fixed, empty result.
 */
function routeDeps(root: string): RouteDeps {
  return {
    libraryRoot: root,
    search: async (query, limit) => ({ query, mode: 'keyword', degraded: '', scanned: limit, deprecated: 0, duplicates: 0, hits: [] }),
    searchStatus: async () => ({ semantic: false, reason: 'spec stub', embedModel: '', warmed: 0, total: 0 }),
    rebuildIndex: async () => {
      if (failingIndexWithString) throw 'index exploded'
      if (failingIndex) throw new Error('索引目录不可写')
      return {
        path: 'index/card-index.json',
        totalCards: 2,
        byType: { rule: 2 },
        byDomain: { 'OA 答复': 2 },
        backup: undefined,
      }
    },
    lint: async (failOn) => ({
      scanned: 2,
      findings: [],
      counts: { critical: 0, warning: 0, suggestion: 0 },
      failOn,
      verdict: 'pass' as const,
    }),
    drafts: {
      list: async () => [DRAFT],
      view: async (id) => (id === DRAFT.id ? { draft: DRAFT, diff: [{ kind: 'added', text: '# 新卡' }], counts: { added: 1, removed: 0 }, existing: false } : undefined),
      confirm: async () => ({ path: DRAFT.target, action: 'created' as const, backup: undefined, deprecated: [] }),
      discard: async (id) => {
        if (id === 'string-boom') throw 'store exploded'
      },
      revert: async (id) => {
        if (id === 'boom') throw new Error('draft boom is pending; only a confirmed draft can be reverted')
        return { path: DRAFT.target, action: 'deleted' as const, restored: [] }
      },
    },
    deleteCard: async (path) => {
      if (path === 'string-boom.md') throw 'delete exploded'
      if (path === 'boom.md') throw new Error('dsh-ip-wiki: cannot delete boom.md: there is no card at that path')
      return { path, title: '被删的卡', stripped: ['cards/rule/kept.md'], totalCards: 1 }
    },
  }
}

/** The one draft the stub store holds. */
const DRAFT = {
  id: 'abc123',
  kind: 'card' as const,
  target: 'cards/rule/new.md',
  type: 'rule' as const,
  title: '新卡',
  content: '---\ntype: rule\n---\n',
  supersedes: [] as readonly string[],
  classification: 'public' as const,
  generatedBy: 'dsh-model' as const,
  policy: 'dsh-model-allowed' as const,
  sourceRef: '',
  note: '',
  createdAt: '2026-09-29T00:00:00.000Z',
  status: 'pending' as const,
  confirmedAt: undefined,
  revertedAt: undefined,
}

beforeEach(async () => {
  fixture = await makeLibrary()
  server = createServer(createHandler(routeDeps(fixture.root)))
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address')
  base = `http://127.0.0.1:${String(address.port)}`
})

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error === undefined) resolve(); else reject(error) })
  })
  await fixture.dispose()
})

/**
 * Post a JSON body to one route.
 * @param path - the route to call.
 * @param body - the value to send, or a raw string.
 * @returns the status and the decoded body.
 */
async function post(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { [GUARD_HEADER]: '1', 'content-type': 'application/json' },
    body: payload,
  })
  return { status: response.status, body: await response.json() }
}

/**
 * Call one route.
 * @param path - path and query to request.
 * @param init - request method, headers, and body.
 * @returns the status and the decoded body.
 */
async function call(
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: unknown }> {
  const headers = init.headers ?? { [GUARD_HEADER]: '1' }
  const response = await fetch(`${base}${path}`, { method: init.method ?? 'GET', headers })
  return { status: response.status, body: await response.json() }
}

describe('the request guard', () => {  it('refuses a request without the plugin header', async () => {
    const response = await call('/dsh-ip-wiki/status', { headers: {} })
    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({ error: `missing ${GUARD_HEADER} request header` })
  })

  it('refuses a cross-site request', async () => {
    const response = await call('/dsh-ip-wiki/status', {
      headers: { [GUARD_HEADER]: '1', 'sec-fetch-site': 'cross-site' },
    })
    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({ error: 'cross-site request refused' })
  })

  it('accepts the same-origin and direct-navigation signals', async () => {
    const sameOrigin = await call('/dsh-ip-wiki/status', {
      headers: { [GUARD_HEADER]: '1', 'sec-fetch-site': 'same-origin' },
    })
    const direct = await call('/dsh-ip-wiki/status', {
      headers: { [GUARD_HEADER]: '1', 'sec-fetch-site': 'none' },
    })
    expect(sameOrigin.status).toBe(200)
    expect(direct.status).toBe(200)
  })

  it('refuses a write on a reading route', async () => {
    const response = await call('/dsh-ip-wiki/status', { method: 'POST' })
    expect(response.status).toBe(405)
    expect(response.body).toMatchObject({ error: 'POST is not allowed on this route; GET is' })
  })

  it('refuses a read on a writing route', async () => {
    const response = await call('/dsh-ip-wiki/draft/confirm')
    expect(response.status).toBe(405)
    expect(response.body).toMatchObject({ error: 'GET is not allowed on this route; POST is' })
  })
})

describe('the routes', () => {
  it('answers the status route', async () => {
    const response = await call('/dsh-ip-wiki/status')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ exists: true, indexDrift: 'none' })
  })

  it('answers the tree route', async () => {
    const response = await call('/dsh-ip-wiki/tree')
    expect(response.status).toBe(200)
    const body = response.body as { status: { counts: { total: number } }; branches: unknown[] }
    expect(body.status.counts.total).toBe(2)
    expect(body.branches).toHaveLength(2)
  })

  it('answers the card route with the document', async () => {
    const response = await call(`/dsh-ip-wiki/card?path=${encodeURIComponent('cards/rule/rule-1.md')}`)
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ id: 'rule-1', title: '创造性判断的三步法' })
  })

  it('answers the card route without a path as not found', async () => {
    const response = await call('/dsh-ip-wiki/card')
    expect(response.status).toBe(404)
    expect(response.body).toMatchObject({ error: 'no card at ' })
  })

  it('answers the card route for a path outside the root as not found', async () => {
    const response = await call(`/dsh-ip-wiki/card?path=${encodeURIComponent('../secret.md')}`)
    expect(response.status).toBe(404)
  })

  it('answers the reports route', async () => {
    const response = await call('/dsh-ip-wiki/reports')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ reports: ['pilot-mapping.md'] })
  })

  it('answers the report route with the text', async () => {
    const response = await call('/dsh-ip-wiki/report?name=pilot-mapping.md')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ name: 'pilot-mapping.md' })
  })

  it('answers a missing report as not found', async () => {
    const response = await call('/dsh-ip-wiki/report?name=gone.md')
    expect(response.status).toBe(404)
    expect(response.body).toMatchObject({ error: 'no report at gone.md' })
  })

  it('answers a report request without a name as not found', async () => {
    const response = await call('/dsh-ip-wiki/report')
    expect(response.status).toBe(404)
    expect(response.body).toMatchObject({ error: 'no report at ' })
  })

  it('answers an unknown route as not found', async () => {
    const response = await call('/dsh-ip-wiki/nope')
    expect(response.status).toBe(404)
    expect(response.body).toMatchObject({ error: 'unknown route /dsh-ip-wiki/nope' })
  })

  it('answers a path outside the prefix as an unknown route', async () => {
    const response = await call('/elsewhere/status')
    expect(response.status).toBe(404)
  })

  it('answers the search route', async () => {
    const response = await call(`/dsh-ip-wiki/search?q=${encodeURIComponent('三步法')}&limit=3`)
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ query: '三步法', mode: 'keyword', scanned: 3 })
  })

  it('answers the search route without a query or a limit', async () => {
    const response = await call('/dsh-ip-wiki/search')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ query: '', scanned: 8 })
  })

  it('answers the quality-gate route with the failure line it was asked for', async () => {
    const strict = await call('/dsh-ip-wiki/lint?failOn=critical')
    expect(strict.status).toBe(200)
    expect(strict.body).toMatchObject({ verdict: 'pass', failOn: 'critical', scanned: 2 })
    const fallback = await call('/dsh-ip-wiki/lint?failOn=nonsense')
    expect(fallback.body).toMatchObject({ failOn: 'warning' })
    const absent = await call('/dsh-ip-wiki/lint')
    expect(absent.body).toMatchObject({ failOn: 'warning' })
  })

  it('deletes a card over POST, and refuses a call that names no path', async () => {
    const done = await post('/dsh-ip-wiki/card/delete', { path: 'cards/rule/rule-1.md' })
    expect(done.status).toBe(200)
    expect(done.body).toMatchObject({ path: 'cards/rule/rule-1.md', title: '被删的卡', totalCards: 1 })

    const missing = await post('/dsh-ip-wiki/card/delete', {})
    expect(missing.status).toBe(400)
    expect(missing.body).toMatchObject({ error: 'path is required' })

    const empty = await post('/dsh-ip-wiki/card/delete', { path: '' })
    expect(empty.status).toBe(400)

    // A refusal from the library reaches the caller as a 400 with its reason.
    const refused = await post('/dsh-ip-wiki/card/delete', { path: 'boom.md' })
    expect(refused.status).toBe(400)
    expect(refused.body).toMatchObject({ error: 'dsh-ip-wiki: cannot delete boom.md: there is no card at that path' })

    const wrongMethod = await call('/dsh-ip-wiki/card/delete')
    expect(wrongMethod.status).toBe(405)

    // A refusal that is not an Error still reaches the caller as text.
    const exploded = await post('/dsh-ip-wiki/card/delete', { path: 'string-boom.md' })
    expect(exploded.status).toBe(400)
    expect(exploded.body).toMatchObject({ error: 'delete exploded' })
  })

  it('rebuilds the index over POST and refuses any other method', async () => {
    const response = await call('/dsh-ip-wiki/index/rebuild', { method: 'POST' })
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ totalCards: 2, path: 'index/card-index.json' })
    const wrong = await call('/dsh-ip-wiki/index/rebuild')
    expect(wrong.status).toBe(405)
    failingIndex = true
    try {
      const failed = await call('/dsh-ip-wiki/index/rebuild', { method: 'POST' })
      expect(failed.status).toBe(400)
      expect(failed.body).toEqual({ error: '索引目录不可写' })
    } finally {
      failingIndex = false
    }
    failingIndexWithString = true
    try {
      const exploded = await call('/dsh-ip-wiki/index/rebuild', { method: 'POST' })
      expect(exploded.body).toEqual({ error: 'index exploded' })
    } finally {
      failingIndexWithString = false
    }
  })

  it('lists the pending drafts', async () => {
    const response = await call('/dsh-ip-wiki/drafts')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ drafts: [{ id: DRAFT.id, target: DRAFT.target }] })
  })

  it('reads one draft with its difference', async () => {
    const response = await call(`/dsh-ip-wiki/draft?id=${DRAFT.id}`)
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ existing: false, counts: { added: 1 }, diff: [{ kind: 'added', text: '# 新卡' }] })
  })

  it('answers an unknown draft as not found', async () => {
    const response = await call('/dsh-ip-wiki/draft?id=nope')
    expect(response.status).toBe(404)
    expect(response.body).toMatchObject({ error: 'no draft nope' })
  })

  it('confirms, discards, and reverts a draft over POST', async () => {
    await expect(post('/dsh-ip-wiki/draft/confirm', { id: DRAFT.id }))
      .resolves.toMatchObject({ status: 200, body: { path: DRAFT.target, action: 'created' } })
    await expect(post('/dsh-ip-wiki/draft/discard', { id: DRAFT.id }))
      .resolves.toMatchObject({ status: 200, body: { ok: true } })
    await expect(post('/dsh-ip-wiki/draft/revert', { id: DRAFT.id }))
      .resolves.toMatchObject({ status: 200, body: { path: DRAFT.target, action: 'deleted' } })
  })

  it('refuses a write with an empty body', async () => {
    const response = await post('/dsh-ip-wiki/draft/confirm', '')
    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({ error: 'id is required' })
  })

  it('refuses a write the store rejects without an Error', async () => {
    const response = await post('/dsh-ip-wiki/draft/discard', { id: 'string-boom' })
    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({ error: 'store exploded' })
  })

  it('answers a draft request without an id as not found', async () => {
    const response = await call('/dsh-ip-wiki/draft')
    expect(response.status).toBe(404)
    expect(response.body).toMatchObject({ error: 'no draft ' })
  })

  it('refuses a write without an id', async () => {
    const response = await post('/dsh-ip-wiki/draft/confirm', {})
    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({ error: 'id is required' })
  })

  it('refuses a write whose body is not JSON', async () => {
    const response = await post('/dsh-ip-wiki/draft/confirm', 'not json')
    expect(response.status).toBe(400)
    expect((response.body as { error: string }).error).toMatch(/Unexpected token|JSON/u)
  })

  it('refuses a write whose body is not an object', async () => {
    const response = await post('/dsh-ip-wiki/draft/confirm', [1, 2])
    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({ error: 'request body must be a JSON object' })
  })

  it('refuses a write whose body is too large', async () => {
    const response = await post('/dsh-ip-wiki/draft/confirm', `"${'x'.repeat(70 * 1024)}"`)
    expect(response.status).toBe(400)
    expect((response.body as { error: string }).error).toMatch(/exceeds 65536 bytes/u)
  })

  it('refuses a write the store rejects, naming why', async () => {
    const response = await post('/dsh-ip-wiki/draft/revert', { id: 'boom' })
    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({ error: 'draft boom is pending; only a confirmed draft can be reverted' })
  })

  it('answers the search-status route', async () => {
    const response = await call('/dsh-ip-wiki/search-status')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ semantic: false, reason: 'spec stub', embedModel: '', warmed: 0, total: 0 })
  })
})

describe('boundedLimit', () => {
  it('falls back when the parameter is absent', () => {
    expect(boundedLimit(null, 8)).toBe(8)
  })

  it('falls back when the parameter is not a number', () => {
    expect(boundedLimit('abc', 8)).toBe(8)
  })

  it('falls back when the parameter is below one', () => {
    expect(boundedLimit('0', 8)).toBe(8)
  })

  it('caps the parameter', () => {
    expect(boundedLimit('999', 8)).toBe(50)
  })

  it('reads a usable parameter', () => {
    expect(boundedLimit('3', 8)).toBe(3)
  })
})

describe('a request the browser never sends', () => {
  /** One response the stub recorded. */
  interface Recorded {
    status: number
    body: unknown
  }

  /**
   * Call the handler with a hand-made request.
   * @param request - the fields the handler reads.
   * @returns what the stub response recorded.
   */
  async function direct(request: { method?: string; url?: string }): Promise<Recorded> {
    const recorded: Recorded[] = []
    const handler = createHandler(routeDeps(fixture.root))
    const res = {
      writeHead: (status: number) => { recorded.push({ status, body: undefined }) },
      end: (body: string) => {
        const last = recorded[recorded.length - 1]
        if (last !== undefined) last.body = JSON.parse(body) as unknown
      },
    } as unknown as ServerResponse
    await handler({ headers: { [GUARD_HEADER]: '1' }, ...request } as unknown as IncomingMessage, res)
    const first = recorded[0]
    if (first === undefined) throw new Error('the handler answered nothing')
    return first
  }

  it('refuses a request that carries no method', async () => {
    expect(await direct({ url: '/dsh-ip-wiki/status' }))
      .toMatchObject({ status: 405, body: { error: 'request is not allowed on this route; GET is' } })
  })

  it('reads a body that arrives as text rather than as a buffer', async () => {
    const recorded: Recorded[] = []
    const handler = createHandler(routeDeps(fixture.root))
    const res = {
      writeHead: (status: number) => { recorded.push({ status, body: undefined }) },
      end: (body: string) => {
        const last = recorded[recorded.length - 1]
        if (last !== undefined) last.body = JSON.parse(body) as unknown
      },
    } as unknown as ServerResponse
    const request = {
      headers: { [GUARD_HEADER]: '1' },
      method: 'POST',
      url: '/dsh-ip-wiki/draft/confirm',
      [Symbol.asyncIterator]: async function* chunks() {
        yield '{"id":'
        yield '"abc123"}'
      },
    } as unknown as IncomingMessage
    await handler(request, res)
    expect(recorded[0]).toMatchObject({ status: 200, body: { path: DRAFT.target, action: 'created' } })
  })

  it('treats a request without a url as no route', async () => {
    expect(await direct({ method: 'GET' }))
      .toMatchObject({ status: 404, body: { error: 'unknown route /dsh-ip-wiki' } })
  })
})
