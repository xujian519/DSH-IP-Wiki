/**
 * Permanent deletion of one card, and of the references that point at it.
 *
 * This is the plugin's first write that cannot be undone, so it is deliberately
 * not a draft: the card file is removed and the library is indexed again. Two
 * rules keep it from leaving a mess behind.
 *
 * 1. **The references go first.** A deck of cards links with `related_concepts`,
 *    and the quality gate reports every link whose target is gone. Rewriting the
 *    referencing cards before the removal means a failure part way through
 *    leaves a card with fewer links — visible, re-runnable — rather than a
 *    dangling reference nothing points back to.
 * 2. **Only `cards/**\/*.md` may be named.** The library root also holds the
 *    reports and the derived index; deletion never reaches them, and the
 *    containment check runs before a byte is read.
 *
 * A reference counts when it names the card's `id` or the `from_id` of the card
 * it superseded, because the quality gate resolves both to the same card.
 *
 * The removal is the plugin's only write that cannot be undone, so it is also the
 * one that most needs a durable trace: the audit line names the card and how many
 * references went with it, and it is written immediately after the file is gone —
 * before the index rebuild, which logs its own line and can fail on its own.
 * @module dsh-ip-wiki/host/delete
 */
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { DeleteResult } from '../shared/card'
import { removeFromListField } from '../shared/frontmatter'
import { rebuildIndex } from './index-file'
import { listCardDocuments, resolveInside } from './library'
import { logLine, writeAtomic } from './workdir'

/** Card files live here and nowhere else; deletion never leaves this directory. */
const CARD_PREFIX = 'cards/'

/**
 * Delete one card, and the references other cards make to it.
 * @param root - absolute library root.
 * @param path - library-relative path of the card to delete.
 * @returns the deleted card, the cards that lost a reference, and the new count.
 * @throws {Error} when the path leaves `cards/`, is not Markdown, or names no card.
 */
export async function deleteCard(root: string, path: string): Promise<DeleteResult> {
  // Containment first: a path that leaves the library never reaches the reader,
  // and neither does the reports directory or the derived index beside the cards.
  const absolute = resolveInside(root, path)
  // A parent segment is refused here even though the resolver would fold one away:
  // the library writes `cards/<kind>/<file>.md`, and nothing else names a card.
  if (path.includes('..') || !path.startsWith(CARD_PREFIX) || !path.endsWith('.md') || absolute === undefined) {
    throw new Error(`dsh-ip-wiki: a card to delete must be a .md file under ${CARD_PREFIX}, got ${path}`)
  }
  const documents = await listCardDocuments(root)
  const target = documents.find(document => document.path === path)
  if (target === undefined) {
    throw new Error(`dsh-ip-wiki: cannot delete ${path}: there is no card at that path`)
  }
  const names = new Set([target.id, target.fromId].filter(name => name !== ''))
  const stripped: string[] = []
  for (const document of documents) {
    if (document.path === path) continue
    if (![...names].some(name => document.relatedConcepts.includes(name))) continue
    // The path came from this library's own walk, so it is inside the root by
    // construction; only the caller-supplied path needs the containment check.
    const reference = join(root, document.path)
    const source = await readFile(reference, 'utf8')
    let next = source
    // A card that reached here holds the name as a parsed list item, and the reader
    // below accepts every item form the parser accepts, so one line always goes.
    for (const name of names) next = removeFromListField(next, 'related_concepts', name) ?? next
    await writeAtomic(reference, next)
    stripped.push(document.path)
  }
  await rm(absolute)
  await logLine(root, `delete ${path} ${String(stripped.length)} references stripped`)
  const built = await rebuildIndex(root)
  return { path, title: target.title, stripped, totalCards: built.totalCards }
}
