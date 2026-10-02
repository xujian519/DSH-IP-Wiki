// @vitest-environment jsdom
/** The client entry: the entries it registers, and the loud failure a missing service gets. */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { PANEL_ID, apply, inject, name } from '../src/client/index'
import { LibraryPanel } from '../src/client/IpWikiPage'
import { IpWikiIcon } from '../src/client/IpWikiIcon'
import { NAMESPACE } from '../src/client/locales'
import type { HostApi } from '../src/client/host-api'
import { GUARD_HEADER, TREE_URL } from '../src/shared/wire'

/** One slot registration the stub registry received. */
interface StubRegistration {
  readonly options: Record<string, unknown>
  readonly component: unknown
}

/** A locale the stub reports, mutable so a spec can switch it between calls. */
interface StubLocale {
  locale: string
}

/** A Cordis client context stub that records what the plugin registers. */
function stubClient(options: { readonly omit?: readonly string[]; readonly locale?: string } = {}): {
  readonly ctx: Context
  readonly injections: string[]
  readonly registrations: StubRegistration[]
  readonly dictionaries: { namespace: string; dictionaries: Record<string, Record<string, string>> }[]
  readonly labels: string[]
  readonly disposed: string[]
  readonly active: StubLocale
} {
  const omitted = new Set(options.omit ?? [])
  const injections: string[] = []
  const registrations: StubRegistration[] = []
  const dictionaries: { namespace: string; dictionaries: Record<string, Record<string, string>> }[] = []
  const labels: string[] = []
  const disposed: string[] = []
  const active: StubLocale = { locale: options.locale ?? 'zh-CN' }
  const services: Record<string, unknown> = {
    slots: {
      inject: (key: string, callback: () => () => void) => {
        injections.push(key)
        callback()
        return () => { disposed.push(`inject:${key}`) }
      },
      register: (registration: Record<string, unknown>, component: unknown) => {
        registrations.push({ options: registration, component })
        return () => { disposed.push(`register:${String(registration['key'] ?? registration['id'])}`) }
      },
    },
    locale: {
      register: (namespace: string, dicts: Record<string, Record<string, string>>) => {
        dictionaries.push({ namespace, dictionaries: dicts })
        return () => { disposed.push('locale') }
      },
      getLocale: () => ({ locale: active.locale }),
    },
  }
  const ctx = {
    get: (key: string) => (omitted.has(key) ? undefined : services[key]),
    effect: (factory: () => (() => void) | undefined, label: string) => {
      labels.push(label)
      factory()
      return () => {}
    },
  } as unknown as Context
  return { ctx, injections, registrations, dictionaries, labels, disposed, active }
}

describe('the client identity', () => {
  it('declares its name and the services it waits for', () => {
    expect(name).toBe('dsh-ip-wiki-client')
    expect(inject).toEqual(['slots', 'locale'])
    expect(PANEL_ID).toBe('ip-wiki')
  })
})

describe('apply', () => {
  it('registers the dictionaries, the panel, and the sidebar entry', () => {
    const stub = stubClient()
    apply(stub.ctx)
    expect(stub.dictionaries).toHaveLength(1)
    expect(stub.dictionaries[0]?.namespace).toBe(NAMESPACE)
    expect(Object.keys(stub.dictionaries[0]?.dictionaries ?? {}).sort()).toEqual(['en', 'zh'])
    expect(stub.injections).toEqual(['main', 'sidebar.panellist'])
    expect(stub.registrations.map(entry => entry.component)).toEqual([LibraryPanel, IpWikiIcon])
    expect(stub.labels).toEqual([
      'dsh-ip-wiki: dictionaries',
      'dsh-ip-wiki: panel',
      'dsh-ip-wiki: sidebar entry',
    ])
  })

  it('addresses the main panel by the same id the sidebar entry uses', () => {
    const stub = stubClient()
    apply(stub.ctx)
    const [panel, entry] = stub.registrations
    expect(panel?.options).toMatchObject({ name: 'main', key: PANEL_ID, locale: NAMESPACE })
    expect(entry?.options).toMatchObject({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, locale: NAMESPACE })
  })

  it('injects the host API and the active locale into the panel', () => {
    const stub = stubClient({ locale: 'en-US' })
    apply(stub.ctx)
    const injector = stub.registrations[0]?.options['inject']
    expect(typeof injector).toBe('function')
    const injected = (injector as () => { api: HostApi; localeId: string })()
    expect(injected.localeId).toBe('en-US')
    expect(Object.keys(injected.api).sort()).toEqual([
      'confirmDraft', 'deleteCard', 'discardDraft', 'fetchCard', 'fetchDraft', 'fetchDrafts', 'fetchLint',
      'fetchReport', 'fetchReports', 'fetchSearch', 'fetchSearchStatus', 'fetchStatus', 'fetchTree',
      'rebuildIndex', 'revertDraft',
    ])
  })

  it('reads the sidebar label in the locale that is active when it is asked', () => {
    const stub = stubClient()
    apply(stub.ctx)
    const label = stub.registrations[1]?.options['label'] as () => string
    expect(label()).toBe('IP 知识库')
    stub.active.locale = 'en'
    expect(label()).toBe('IP Knowledge Wiki')
  })

  it('falls back to Chinese when the locale service reports none', () => {
    const stub = stubClient()
    stub.active.locale = ''
    apply(stub.ctx)
    const label = stub.registrations[1]?.options['label'] as () => string
    expect(label()).toBe('IP 知识库')
    const injector = stub.registrations[0]?.options['inject'] as () => { localeId: string }
    expect(injector().localeId).toBe('zh')
  })

  it('fails loud when the composition has no slot registry', () => {
    expect(() => { apply(stubClient({ omit: ['slots'] }).ctx) }).toThrow(/no "slots"/u)
  })

  it('fails loud when the composition has no locale registry', () => {
    expect(() => { apply(stubClient({ omit: ['locale'] }).ctx) }).toThrow(/no "locale"/u)
  })

  it('reaches the host through the browser fetch with the guard header', async () => {
    const stub = stubClient()
    apply(stub.ctx)
    const calls: { url: string; headers: Record<string, string> }[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers })
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: { root: '/lib' }, branches: [] }),
      }
    }) as unknown as typeof fetch
    try {
      const injector = stub.registrations[0]?.options['inject'] as () => { api: { fetchTree(): Promise<unknown> } }
      await injector().api.fetchTree()
    } finally {
      globalThis.fetch = original
    }
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(TREE_URL)
    expect(calls[0]?.headers[GUARD_HEADER]).toBe('1')
  })
})
