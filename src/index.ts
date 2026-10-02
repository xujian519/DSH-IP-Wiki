/**
 * Host half of the IP knowledge library.
 *
 * It owns everything the browser half cannot do itself: reading the card library
 * from disk, answering the panel's requests, and running retrieval for both the
 * panel and the agent tools. The library root is a required configuration field,
 * because where a user keeps their knowledge is a deployment decision, not a
 * constant this package may guess.
 *
 * Service access goes through `ctx.get(...)` with the structural types declared
 * below rather than imports from other DSH packages, so this package's runtime
 * carries no dependency on any harness package and cannot break on a version
 * skew.
 * @module dsh-ip-wiki
 */
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolveEmbeddingPlan, type EmbeddingConfig } from './host/embeddings'
import { isAbsoluteRoot } from './host/library'
import { GUIDANCE_NAME, GUIDANCE_ORDER, guidance } from './host/guidance'
import { ROUTE_PREFIX } from './shared/wire'
import { createHandler } from './host/routes'
import { deleteCard } from './host/delete'
import { createSearchService } from './host/search'
import {
  confirmDraft,
  discardDraft,
  listDrafts,
  revertDraft,
  viewDraft,
  type SourcePolicy,
} from './host/drafts'
import { rebuildIndex } from './host/index-file'
import { asTier, readLintReport, type LintTier } from './host/lint'
import { ipWikiTools, type ToolRegistryLike } from './host/tools'
import { missingService } from './missing-service'

/** Plugin name, as the Loader entry and diagnostics spell it. */
export const name = 'dsh-ip-wiki'

/**
 * Services the host half cannot work without: the routes go on the Web server, the
 * guidance goes into the prompt registry, and the retrieval tools go into the tool
 * registry. Declaring them here also makes the Loader order this plugin after them.
 */
export const inject = ['webServer', 'systemPrompt', 'tools']

/** The row's configuration, as `cordis.patch.yml` may set it. */
export interface Config {
  /**
   * Absolute path of the card library this plugin reads. Required: a guessed
   * default would silently point the panel at the wrong directory.
   */
  readonly libraryRoot?: string
  /**
   * Local embedding and rerank settings. Absent means semantic retrieval is off
   * and search answers from keywords alone.
   */
  readonly embedding?: EmbeddingConfig
  /** Relevance floor for semantic candidates before reranking; defaults to 0.25. */
  readonly minScore?: number
  /**
   * Which models each material class may be sent to. Client material defaults to
   * `local-only`, which makes a draft recording a DSH model fail loudly.
   */
  readonly sourcePolicy?: SourcePolicy
  /** The tier the quality gate fails on; defaults to `warning`. */
  readonly lintFailOn?: LintTier
}

/** One named route as the Web server accepts it. */
interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** The prompt registry slice this plugin contributes to. */
interface SystemPromptLike {
  section(section: { name: string; order: number; text: string; stable?: boolean }): () => void
}

/**
 * Resolve and check the configured library root.
 * @param config - the row's configuration.
 * @returns the absolute library root.
 * @throws {Error} when the field is absent, blank, or not an absolute path.
 */
export function resolveLibraryRoot(config: Config): string {
  const root = config.libraryRoot
  if (root === undefined || root.trim() === '') {
    throw new Error('dsh-ip-wiki: config.libraryRoot is required; set it to the absolute path of the card library')
  }
  if (root !== root.trim() || !isAbsoluteRoot(root)) {
    throw new Error(`dsh-ip-wiki: config.libraryRoot must be an absolute path without surrounding blanks, got ${JSON.stringify(root)}`)
  }
  return root
}

/**
 * Mount the host half.
 * @param ctx - the plugin's Cordis context.
 * @param config - the row's configuration, carrying the library root.
 * @throws {Error} when a required service is missing from the composition, or the
 * configured library root is unusable.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const root = resolveLibraryRoot(config)
  const webServer = ctx.get('webServer') as WebServerLike | undefined
  const systemPrompt = ctx.get('systemPrompt') as SystemPromptLike | undefined
  const tools = ctx.get('tools') as ToolRegistryLike | undefined
  if (webServer === undefined) throw new Error(missingService('webServer'))
  if (systemPrompt === undefined) throw new Error(missingService('systemPrompt'))
  if (tools === undefined) throw new Error(missingService('tools'))
  const search = createSearchService({
    libraryRoot: root,
    plan: resolveEmbeddingPlan(config.embedding),
    fetchImpl: globalThis.fetch,
    minScore: config.minScore,
  })
  // Warm the vector cache while nothing is waiting on it. The whole corpus takes about
  // 110 s to embed, so a start that leaves it to the first search makes that search
  // answer from keywords. The disposer stops the run before its next batch.
  ctx.effect(
    () => search.warm(),
    'dsh-ip-wiki: vector warmup',
  )
  ctx.effect(
    () => webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: createHandler({
        libraryRoot: root,
        search: (query, limit) => search.search(query, limit),
        searchStatus: () => search.describe(),
        lint: (failOn) => readLintReport(root, failOn),
        rebuildIndex: () => rebuildIndex(root),
        drafts: {
          list: () => listDrafts(root),
          view: (id) => viewDraft(root, id),
          confirm: (id) => confirmDraft(root, id),
          discard: (id) => discardDraft(root, id),
          revert: (id) => revertDraft(root, id),
        },
        deleteCard: (path) => deleteCard(root, path),
      }),
    }),
    'dsh-ip-wiki: library routes',
  )
  ctx.effect(
    () => {
      const failOn = asTier(config.lintFailOn, 'warning')
      const disposers = ipWikiTools({ libraryRoot: root, search, sourcePolicy: config.sourcePolicy, lintFailOn: failOn })
        .map(tool => tools.register(tool))
      return () => { for (const dispose of disposers) dispose() }
    },
    'dsh-ip-wiki: retrieval tools',
  )
  ctx.effect(
    () => systemPrompt.section({
      name: GUIDANCE_NAME,
      order: GUIDANCE_ORDER,
      text: guidance(root),
      stable: true,
    }),
    'dsh-ip-wiki: guidance',
  )
}
