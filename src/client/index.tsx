/**
 * Browser half of the IP knowledge library.
 *
 * It registers the sidebar's entry for the library and the panel that entry
 * opens; all reading goes through the Host's routes, so this half holds no state
 * of its own beyond the panel's view state.
 *
 * Both services are hard requirements: without the slot registry there is nowhere
 * to render, and without the locale registry no copy to render with. A composition
 * missing either gets a loud failure rather than a silently half-mounted plugin.
 * @module dsh-ip-wiki/client
 */
import type { Context } from '@deepseek-ai/cordis'
import { IpWikiIcon } from './IpWikiIcon'
import { LibraryPanel, type LibraryPanelProps } from './IpWikiPage'
import { createHostApi, type Fetcher } from './host-api'
import { NAMESPACE, dictionaryFor, en, zh } from './locales'
import { missingService } from '../missing-service'

/** Plugin name reported to the client module loader. */
export const name = 'dsh-ip-wiki-client'

/** Client services this plugin waits for before it mounts anything. */
export const inject = ['slots', 'locale']

/** Panel identity, shared by the sidebar entry and the main panel it addresses. */
export const PANEL_ID = 'ip-wiki'

/** Position of this entry among the sidebar's panel icons. */
const PANEL_ORDER = 20

/** Slot registry slice this plugin registers into. */
interface SlotsLike {
  inject(key: string, callback: () => () => void): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

/** Locale registry slice this plugin registers into. */
interface LocaleLike {
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
  getLocale(): { readonly locale?: string }
}

/** The browser's `fetch`, narrowed to what the API module uses. */
const browserFetcher: Fetcher = (url, init) => fetch(url, init)

/**
 * Mount the browser half.
 * @param ctx - the plugin's client context.
 * @throws {Error} when a required service is missing from the composition.
 */
export function apply(ctx: Context): void {
  const locale = ctx.get('locale') as LocaleLike | undefined
  const slots = ctx.get('slots') as SlotsLike | undefined
  if (locale === undefined) throw new Error(missingService('locale'))
  if (slots === undefined) throw new Error(missingService('slots'))
  const active = (): string => {
    const reported = locale.getLocale().locale
    return reported === undefined || reported === '' ? 'zh' : reported
  }
  const api = createHostApi(browserFetcher)
  ctx.effect(
    () => locale.register(NAMESPACE, { zh, en }),
    'dsh-ip-wiki: dictionaries',
  )
  ctx.effect(() => slots.inject('main', () => slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NAMESPACE,
    inject: (): LibraryPanelProps => ({ api, localeId: active() }),
  }, LibraryPanel)), 'dsh-ip-wiki: panel')
  ctx.effect(() => slots.inject('sidebar.panellist', () => slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: PANEL_ORDER,
    locale: NAMESPACE,
    label: () => dictionaryFor(active()).panel,
  }, IpWikiIcon)), 'dsh-ip-wiki: sidebar entry')
}
