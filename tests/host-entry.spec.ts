/** The host entry: what it mounts, what it validates, and the loud failure a missing service gets. */
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { apply, inject, name, resolveLibraryRoot } from '../src/index'
import { GUIDANCE_NAME, GUIDANCE_ORDER, guidance } from '../src/host/guidance'
import { GUARD_HEADER, ROUTE_PREFIX } from '../src/shared/wire'
import { missingService } from '../src/missing-service'
import { makeLibrary } from './fixtures'

/** One route the stub Web server was asked to serve. */
interface StubRoute {
  readonly kind: string
  readonly path: string
  readonly handler: unknown
}

/** One prompt section the stub registry was asked to contribute. */
interface StubSection {
  readonly name: string
  readonly order: number
  readonly text: string
  readonly stable?: boolean
}

/** A Cordis context stub that records what the plugin mounts. */
function stubContext(options: { readonly omit?: readonly string[] } = {}): {
  readonly ctx: Context
  readonly routes: StubRoute[]
  readonly sections: StubSection[]
  readonly tools: { name: string }[]
  readonly labels: string[]
  readonly disposers: (() => void)[]
  readonly disposed: string[]
} {
  const omitted = new Set(options.omit ?? [])
  const routes: StubRoute[] = []
  const sections: StubSection[] = []
  const tools: { name: string }[] = []
  const labels: string[] = []
  const disposers: (() => void)[] = []
  const disposed: string[] = []
  const services: Record<string, unknown> = {
    webServer: {
      register: (route: StubRoute) => {
        routes.push(route)
        return () => { disposed.push('route') }
      },
    },
    systemPrompt: {
      section: (section: StubSection) => {
        sections.push(section)
        return () => { disposed.push('guidance') }
      },
    },
    tools: {
      register: (tool: { name: string }) => {
        tools.push(tool)
        return () => { disposed.push(`tool:${tool.name}`) }
      },
    },
  }
  const ctx = {
    get: (key: string) => (omitted.has(key) ? undefined : services[key]),
    effect: (factory: () => (() => void) | undefined, label: string) => {
      labels.push(label)
      const dispose = factory()
      if (dispose !== undefined) disposers.push(dispose)
      return () => {}
    },
  } as unknown as Context
  return { ctx, routes, sections, tools, labels, disposers, disposed }
}

describe('the plugin identity', () => {
  it('declares its name and the services it cannot mount without', () => {
    expect(name).toBe('dsh-ip-wiki')
    expect(inject).toEqual(['webServer', 'systemPrompt', 'tools'])
  })

  it('names the missing service in one sentence', () => {
    expect(missingService('webServer')).toContain('no "webServer"')
  })
})

describe('resolveLibraryRoot', () => {
  it('accepts an absolute path', () => {
    expect(resolveLibraryRoot({ libraryRoot: '/lib' })).toBe('/lib')
  })

  it('refuses an absent root', () => {
    expect(() => resolveLibraryRoot({})).toThrow(/libraryRoot is required/u)
  })

  it('refuses a blank root', () => {
    expect(() => resolveLibraryRoot({ libraryRoot: '   ' })).toThrow(/libraryRoot is required/u)
  })

  it('refuses a relative root', () => {
    expect(() => resolveLibraryRoot({ libraryRoot: 'lib' })).toThrow(/must be an absolute path/u)
  })

  it('refuses a root with surrounding blanks', () => {
    expect(() => resolveLibraryRoot({ libraryRoot: ' /lib ' })).toThrow(/must be an absolute path/u)
  })
})

describe('apply', () => {
  it('registers the routes, the retrieval tools, and the guidance, and its effects dispose', async () => {
    const fixture = await makeLibrary()
    const stub = stubContext()
    apply(stub.ctx, { libraryRoot: fixture.root })
    expect(stub.routes).toHaveLength(1)
    expect(stub.routes[0]?.kind).toBe('prefix')
    expect(stub.routes[0]?.path).toBe(ROUTE_PREFIX)
    expect(stub.tools.map(tool => tool.name)).toEqual([
      'ip_wiki_search', 'ip_wiki_get', 'ip_wiki_cite', 'ip_wiki_draft', 'ip_wiki_review', 'ip_wiki_confirm', 'ip_wiki_lint',
    ])
    expect(stub.sections).toHaveLength(1)
    expect(stub.sections[0]).toMatchObject({
      name: GUIDANCE_NAME,
      order: GUIDANCE_ORDER,
      stable: true,
    })
    expect(stub.sections[0]?.text).toContain(fixture.root)
    expect(stub.labels).toEqual([
      'dsh-ip-wiki: vector warmup',
      'dsh-ip-wiki: library routes',
      'dsh-ip-wiki: retrieval tools',
      'dsh-ip-wiki: guidance',
    ])
    for (const dispose of stub.disposers) dispose()
    expect(stub.disposed).toEqual([
      'route',
      'tool:ip_wiki_search',
      'tool:ip_wiki_get',
      'tool:ip_wiki_cite',
      'tool:ip_wiki_draft',
      'tool:ip_wiki_review',
      'tool:ip_wiki_confirm',
      'tool:ip_wiki_lint',
      'guidance',
    ])
    await fixture.dispose()
  })

  it('mounts with semantic retrieval off when the row configures none', async () => {
    const fixture = await makeLibrary()
    const stub = stubContext()
    apply(stub.ctx, { libraryRoot: fixture.root, minScore: 0.4 })
    expect(stub.routes).toHaveLength(1)
    await fixture.dispose()
  })

  it('answers search through the route it registered', async () => {
    const fixture = await makeLibrary()
    const stub = stubContext()
    apply(stub.ctx, { libraryRoot: fixture.root })
    const handler = stub.routes[0]?.handler as (req: IncomingMessage, res: ServerResponse) => Promise<void>
    const answers: unknown[] = []
    const res = {
      writeHead: () => {},
      end: (body: string) => { answers.push(JSON.parse(body) as unknown) },
    } as unknown as ServerResponse
    const request = (url: string): IncomingMessage => ({
      headers: { [GUARD_HEADER]: '1' },
      method: 'GET',
      url,
    } as unknown as IncomingMessage)
    await handler(request(`/dsh-ip-wiki/search?q=${encodeURIComponent('三步法')}`), res)
    await handler(request('/dsh-ip-wiki/search-status'), res)
    expect(answers[0]).toMatchObject({ query: '三步法', mode: 'keyword' })
    expect(answers[1]).toEqual({
      semantic: false,
      reason: '未配置 embedding（config.embedding 缺失）',
      embedModel: '',
      warmed: 0,
      total: 0,
    })
    await fixture.dispose()
  })

  it('answers the draft routes through the handler it registered', async () => {
    const fixture = await makeLibrary()
    const stub = stubContext()
    apply(stub.ctx, { libraryRoot: fixture.root })
    const handler = stub.routes[0]?.handler as (req: IncomingMessage, res: ServerResponse) => Promise<void>
    const answers: unknown[] = []
    const res = {
      writeHead: () => {},
      end: (body: string) => { answers.push(JSON.parse(body) as unknown) },
    } as unknown as ServerResponse
    const request = (method: string, url: string, body = '{"id":"missing"}'): IncomingMessage => ({
      headers: { [GUARD_HEADER]: '1' },
      method,
      url,
      [Symbol.asyncIterator]: async function* requestBody() { yield body },
    } as unknown as IncomingMessage)
    await handler(request('POST', '/dsh-ip-wiki/index/rebuild'), res)
    await handler(request('GET', '/dsh-ip-wiki/lint?failOn=critical'), res)
    await handler(request('GET', '/dsh-ip-wiki/drafts'), res)
    await handler(request('GET', '/dsh-ip-wiki/draft?id=missing'), res)
    await handler(request('POST', '/dsh-ip-wiki/draft/confirm'), res)
    await handler(request('POST', '/dsh-ip-wiki/draft/discard'), res)
    await handler(request('POST', '/dsh-ip-wiki/draft/revert'), res)
    await handler(request('POST', '/dsh-ip-wiki/card/delete', '{"path":"cards/rule/rule-1.md"}'), res)
    expect(answers[0]).toMatchObject({ totalCards: 2, path: 'index/card-index.json' })
    expect(answers[1]).toMatchObject({ failOn: 'critical', scanned: 2 })
    expect(answers[2]).toEqual({ drafts: [] })
    expect(answers[3]).toEqual({ error: 'no draft missing' })
    expect(answers[4]).toEqual({ error: 'dsh-ip-wiki: no draft missing' })
    expect(answers[5]).toEqual({ error: 'dsh-ip-wiki: no draft missing' })
    expect(answers[6]).toEqual({ error: 'dsh-ip-wiki: no draft missing' })
    // The deletion route reaches the card on disk and reports what is left.
    expect(answers[7]).toMatchObject({ path: 'cards/rule/rule-1.md', title: '创造性判断的三步法', totalCards: 1 })
    await fixture.dispose()
  })

  it('fails loud when the composition has no Web server', () => {
    expect(() => { apply(stubContext({ omit: ['webServer'] }).ctx, { libraryRoot: '/lib' }) })
      .toThrow(/no "webServer"/u)
  })

  it('fails loud when the composition has no prompt registry', () => {
    expect(() => { apply(stubContext({ omit: ['systemPrompt'] }).ctx, { libraryRoot: '/lib' }) })
      .toThrow(/no "systemPrompt"/u)
  })

  it('fails loud when the composition has no tool registry', () => {
    expect(() => { apply(stubContext({ omit: ['tools'] }).ctx, { libraryRoot: '/lib' }) })
      .toThrow(/no "tools"/u)
  })

  it('fails loud when the row carries no library root', () => {
    expect(() => { apply(stubContext().ctx) }).toThrow(/libraryRoot is required/u)
  })
})

describe('guidance', () => {
  it('names the root, the card kinds, and the confirmation rule', () => {
    const text = guidance('/lib')
    expect(text).toContain('/lib')
    expect(text).toContain('概念卡')
    expect(text).toContain('草稿')
    expect(text).toContain('IP 知识库')
  })
})
