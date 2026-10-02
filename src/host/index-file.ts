/**
 * Rebuilding the derived card index.
 *
 * The index is a derived artifact: the cards on disk are the truth, and this puts
 * their current state back into `index/card-index.json`. Two properties matter.
 * First, the rebuild is conservative — keys the plugin does not own (the migration's
 * `source_index_last_updated`, any index a later tool adds) are carried over
 * untouched rather than dropped. Second, it is reversible in the cheap sense: the
 * previous bytes are kept under the work directory before the file is replaced.
 * @module dsh-ip-wiki/host/index-file
 */
import { readFile } from 'node:fs/promises'
import { countsOf, inside, INDEX_FILE, listCardDocuments } from './library'
import { BACKUPS_DIR, logLine, writeAtomic } from './workdir'

/** What a rebuild wrote. */
export interface IndexBuildResult {
  /** The index path, relative to the library root. */
  readonly path: string
  /** How many cards the index now describes. */
  readonly totalCards: number
  /** Count per card kind. */
  readonly byType: Readonly<Record<string, number>>
  /** Count per business domain. */
  readonly byDomain: Readonly<Record<string, number>>
  /** Where the previous index was kept, or `undefined` when there was none. */
  readonly backup: string | undefined
}

/** Read one file as text, or `undefined`. */
async function readTextOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    // A missing index is the case this function exists for, not an error.
    return undefined
  }
}

/** Read the keys of an existing index that this rebuild does not own. */
function carriedOver(previous: string | undefined): Record<string, unknown> {
  if (previous === undefined) return {}
  try {
    const parsed: unknown = JSON.parse(previous)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return { ...(parsed as Record<string, unknown>) }
  } catch {
    // An index that cannot be parsed carries nothing worth preserving; the cards
    // are the truth, so the rebuild simply writes a fresh one.
    return {}
  }
}

/**
 * Write the index the cards on disk imply.
 * @param root - absolute library root.
 * @returns what was written.
 */
export async function rebuildIndex(root: string): Promise<IndexBuildResult> {
  const documents = await listCardDocuments(root)
  const path = inside(root, INDEX_FILE)
  const previous = await readTextOrUndefined(path)
  const carried = carriedOver(previous)
  const counts = countsOf(documents)
  const schemaVersion = carried['schema_version']
  const index = {
    ...carried,
    schema_version: typeof schemaVersion === 'number' ? schemaVersion : 1,
    library: root,
    generated_at: new Date().toISOString(),
    total_cards: documents.length,
    by_type: counts.byType,
    by_domain: counts.byDomain,
    cards: documents.map(document => ({
      id: document.id,
      type: document.type,
      title: document.title,
      domain_l1: document.domainL1,
      domain_l2: document.domainL2,
      concept: document.concept,
      status: document.status,
      path: document.path,
      related_concepts: document.relatedConcepts,
    })),
  }
  let backup: string | undefined
  if (previous !== undefined) {
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
    const copy = inside(root, ...`${BACKUPS_DIR}/index/${stamp}.json`.split('/'))
    await writeAtomic(copy, previous)
    backup = `${BACKUPS_DIR}/index/${stamp}.json`
  }
  await writeAtomic(path, `${JSON.stringify(index, null, 2)}\n`)
  await logLine(root, `index rebuilt ${String(documents.length)} cards${backup === undefined ? '' : ` backup ${backup}`}`)
  return {
    path: INDEX_FILE,
    totalCards: documents.length,
    byType: counts.byType,
    byDomain: counts.byDomain,
    backup,
  }
}
