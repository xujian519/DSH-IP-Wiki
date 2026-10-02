/** The Client's host API: the requests it builds and the failures it reports. */
import { describe, expect, it } from 'vitest'
import { createHostApi, type Fetcher } from '../src/client/host-api'
import { CARD_DELETE_URL, DRAFT_CONFIRM_URL, GUARD_HEADER, INDEX_REBUILD_URL, ROUTE_PREFIX, cardUrl, draftUrl, lintUrl, reportUrl, searchUrl } from '../src/shared/wire'

/** One recorded call and the answers the stub gives per URL. */
function stubFetcher(answers: Record<string, { ok: boolean; status: number; body: unknown }>): {
  readonly fetcher: Fetcher
  readonly calls: { url: string; headers: Record<string, string> }[]
} {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, headers: init.headers ?? {} })
    const answer = answers[url]
    if (answer === undefined) throw new Error(`unexpected request: ${url}`)
    return {
      ok: answer.ok,
      status: answer.status,
      json: async () => answer.body,
    }
  }
  return { fetcher, calls }
}

/** One draft the host would send. */
const DRAFT = {
  id: 'abc',
  target: 'cards/rule/a.md',
  type: 'rule',
  title: '拟新增',
  content: '---\ntype: rule\n---\n',
  classification: 'public',
  generatedBy: 'human',
  policy: 'dsh-model-allowed',
  sourceRef: '',
  note: '',
  createdAt: '2026-09-29T00:00:00.000Z',
  status: 'pending',
  confirmedAt: undefined,
  revertedAt: undefined,
}

/** A search answer with one hit. */
const SEARCH = {
  query: '三步法',
  mode: 'rerank',
  degraded: '',
  scanned: 2,
  deprecated: 0,
  duplicates: 0,
  hits: [{
    path: 'cards/rule/rule-1.md',
    title: '创造性判断的三步法',
    type: 'rule',
    domainL2: 'OA 答复',
    concept: '三步法',
    lawRefs: ['专利法第 22 条第 3 款'],
    sourcePath: '/vault/cards/rule-1.md',
    score: 0.9,
    matched: ['keyword', 'vector', 'rerank'],
    snippet: '三步法的第一步',
  }],
}

/** A tree payload with one branch and one card. */
const TREE = {
  status: {
    root: '/lib',
    exists: true,
    counts: { total: 1, byType: { rule: 1 }, byDomain: { OA: 1 }, byStatus: { draft: 1 } },
    indexGeneratedAt: '2026-09-29T00:00:00+08:00',
    indexTotalCards: 1,
    indexDrift: 'none',
    reports: ['pilot-mapping.md'],
    needsReview: [],
    problem: '',
  },
  branches: [{
    type: 'rule',
    label: '规则卡',
    total: 1,
    groups: [{ key: 'rule/OA', label: 'OA', cards: [{ type: 'rule', path: 'cards/rule/a.md', title: 'A' }] }],
  }],
}

describe('createHostApi', () => {
  it('sends the guard header on every request', async () => {
    const stub = stubFetcher({ [`${ROUTE_PREFIX}/tree`]: { ok: true, status: 200, body: TREE } })
    await createHostApi(stub.fetcher).fetchTree()
    expect(stub.calls).toEqual([{ url: `${ROUTE_PREFIX}/tree`, headers: { [GUARD_HEADER]: '1' } }])
  })

  it('reads the tree', async () => {
    const stub = stubFetcher({ [`${ROUTE_PREFIX}/tree`]: { ok: true, status: 200, body: TREE } })
    const tree = await createHostApi(stub.fetcher).fetchTree()
    expect(tree.status.counts.total).toBe(1)
    expect(tree.branches[0]?.groups[0]?.cards[0]?.title).toBe('A')
  })

  it('reads the status alone', async () => {
    const stub = stubFetcher({ [`${ROUTE_PREFIX}/status`]: { ok: true, status: 200, body: TREE.status } })
    const status = await createHostApi(stub.fetcher).fetchStatus()
    expect(status.root).toBe('/lib')
    expect(status.indexDrift).toBe('none')
  })

  it('builds the search URL with an encoded query and a limit', () => {
    expect(searchUrl('三步法', 5)).toBe(`${ROUTE_PREFIX}/search?q=%E4%B8%89%E6%AD%A5%E6%B3%95&limit=5`)
  })

  it('reads one card through its encoded path', async () => {
    const url = cardUrl('cards/rule/a b.md')
    const stub = stubFetcher({ [url]: { ok: true, status: 200, body: { type: 'rule', title: 'A', path: 'cards/rule/a b.md' } } })
    const card = await createHostApi(stub.fetcher).fetchCard('cards/rule/a b.md')
    expect(url).toBe(`${ROUTE_PREFIX}/card?path=cards%2Frule%2Fa%20b.md`)
    expect(card.title).toBe('A')
  })

  it('reads one report and the report list', async () => {
    const stub = stubFetcher({
      [reportUrl('pilot-mapping.md')]: { ok: true, status: 200, body: { name: 'pilot-mapping.md', text: '# 报告' } },
      [`${ROUTE_PREFIX}/reports`]: { ok: true, status: 200, body: { reports: ['pilot-mapping.md'] } },
    })
    const api = createHostApi(stub.fetcher)
    await expect(api.fetchReport('pilot-mapping.md')).resolves.toEqual({ name: 'pilot-mapping.md', text: '# 报告' })
    await expect(api.fetchReports()).resolves.toEqual(['pilot-mapping.md'])
  })

  it('reads a search answer', async () => {
    const stub = stubFetcher({ [searchUrl('三步法', 5)]: { ok: true, status: 200, body: SEARCH } })
    const result = await createHostApi(stub.fetcher).fetchSearch('三步法', 5)
    expect(result.mode).toBe('rerank')
    expect(result.hits[0]?.title).toBe('创造性判断的三步法')
    expect(result.hits[0]?.matched).toEqual(['keyword', 'vector', 'rerank'])
    expect(result.hits[0]?.lawRefs).toEqual(['专利法第 22 条第 3 款'])
    expect(result.degraded).toBe('')
  })

  it('reads the retrieval status', async () => {
    const stub = stubFetcher({ [`${ROUTE_PREFIX}/search-status`]: { ok: true, status: 200, body: { semantic: true, reason: '', embedModel: 'm' } } })
    await expect(createHostApi(stub.fetcher).fetchSearchStatus()).resolves.toEqual({ semantic: true, reason: '', embedModel: 'm', warmed: 0, total: 0 })
  })

  it('reports a search that failed', async () => {
    const stub = stubFetcher({ [searchUrl('x', 5)]: { ok: false, status: 500, body: { error: '检索挂了' } } })
    await expect(createHostApi(stub.fetcher).fetchSearch('x', 5)).rejects.toThrow('检索挂了')
  })

  it('rebuilds the index over POST', async () => {
    const stub = stubFetcher({
      [INDEX_REBUILD_URL]: {
        ok: true,
        status: 200,
        body: { path: 'index/card-index.json', totalCards: 31, byType: { rule: 26 }, byDomain: {}, backup: '.dsh-ip-wiki/backups/index/x.json' },
      },
    })
    const built = await createHostApi(stub.fetcher).rebuildIndex()
    expect(built.totalCards).toBe(31)
    expect(built.byType).toEqual({ rule: 26 })
    expect(built.backup).toContain('backups/index')
    expect(stub.calls[0]?.url).toBe(INDEX_REBUILD_URL)
  })

  it('reads a quality-gate report', async () => {
    const stub = stubFetcher({
      [lintUrl('critical')]: {
        ok: true,
        status: 200,
        body: { scanned: 2, findings: [], counts: { critical: 0 }, failOn: 'critical', verdict: 'pass' },
      },
    })
    const report = await createHostApi(stub.fetcher).fetchLint('critical')
    expect(report.verdict).toBe('pass')
    expect(report.failOn).toBe('critical')
    expect(lintUrl('critical')).toBe(`${ROUTE_PREFIX}/lint?failOn=critical`)
  })

  it('reads the pending drafts and one draft with its difference', async () => {
    const stub = stubFetcher({
      [`${ROUTE_PREFIX}/drafts`]: { ok: true, status: 200, body: { drafts: [DRAFT] } },
      [draftUrl('abc')]: {
        ok: true,
        status: 200,
        body: { draft: DRAFT, diff: [{ kind: 'added', text: 'a' }], counts: { added: 1, removed: 0 }, existing: false },
      },
    })
    const api = createHostApi(stub.fetcher)
    await expect(api.fetchDrafts()).resolves.toHaveLength(1)
    const view = await api.fetchDraft('abc')
    expect(view.counts).toEqual({ added: 1, removed: 0 })
    expect(view.diff[0]).toEqual({ kind: 'added', text: 'a' })
  })

  it('confirms, discards, and reverts over POST', async () => {
    const stub = stubFetcher({
      [DRAFT_CONFIRM_URL]: { ok: true, status: 200, body: { path: 'cards/rule/a.md', action: 'replaced', backup: 'b' } },
      [`${ROUTE_PREFIX}/draft/discard`]: { ok: true, status: 200, body: { ok: true } },
      [`${ROUTE_PREFIX}/draft/revert`]: { ok: true, status: 200, body: { path: 'cards/rule/a.md', action: 'deleted' } },
    })
    const api = createHostApi(stub.fetcher)
    await expect(api.confirmDraft('abc')).resolves.toEqual({
      path: 'cards/rule/a.md', action: 'replaced', backup: 'b', deprecated: [],
    })
    await expect(api.discardDraft('abc')).resolves.toBeUndefined()
    await expect(api.revertDraft('abc')).resolves.toEqual({
      path: 'cards/rule/a.md', action: 'deleted', restored: [],
    })
  })

  it('deletes a card over POST and reads what it cleared', async () => {
    const stub = stubFetcher({
      [CARD_DELETE_URL]: {
        ok: true,
        status: 200,
        body: { path: 'cards/rule/a.md', title: '要删的卡', stripped: ['cards/rule/b.md'], totalCards: 4 },
      },
    })
    const api = createHostApi(stub.fetcher)
    await expect(api.deleteCard('cards/rule/a.md')).resolves.toEqual({
      path: 'cards/rule/a.md', title: '要删的卡', stripped: ['cards/rule/b.md'], totalCards: 4,
    })
    expect(stub.calls[0]?.url).toBe(CARD_DELETE_URL)
    expect(stub.calls[0]?.headers[GUARD_HEADER]).toBe('1')
  })

  it('reports a write the host refuses', async () => {
    const stub = stubFetcher({
      [DRAFT_CONFIRM_URL]: { ok: false, status: 400, body: { error: 'draft abc is pending, not confirmed' } },
    })
    await expect(createHostApi(stub.fetcher).confirmDraft('abc'))
      .rejects.toThrow('draft abc is pending, not confirmed')
  })

  it('reports the message a failed response carries', async () => {
    const stub = stubFetcher({ [cardUrl('')]: { ok: false, status: 404, body: { error: 'no card at x' } } })
    await expect(createHostApi(stub.fetcher).fetchCard('')).rejects.toThrow('no card at x')
  })

  it('falls back to the status line when a failed response carries no message', async () => {
    const stub = stubFetcher({ [`${ROUTE_PREFIX}/status`]: { ok: false, status: 500, body: 'boom' } })
    await expect(createHostApi(stub.fetcher).fetchStatus()).rejects.toThrow('HTTP 500')
  })

  it('falls back to the status line when the failure body carries no error text', async () => {
    const stub = stubFetcher({ [`${ROUTE_PREFIX}/status`]: { ok: false, status: 502, body: {} } })
    await expect(createHostApi(stub.fetcher).fetchStatus()).rejects.toThrow('HTTP 502')
  })

  it('fails when a successful response is not JSON', async () => {
    const fetcher: Fetcher = async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new Error('not json') },
    })
    await expect(createHostApi(fetcher).fetchTree()).rejects.toThrow(/tree is not an object/u)
  })

  it('fails when a successful response carries an unexpected payload', async () => {
    const stub = stubFetcher({ [`${ROUTE_PREFIX}/tree`]: { ok: true, status: 200, body: 3 } })
    await expect(createHostApi(stub.fetcher).fetchTree()).rejects.toThrow(/tree is not an object/u)
  })
})
