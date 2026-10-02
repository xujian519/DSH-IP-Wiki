/**
 * The draft store: material becomes a card only through a draft the user confirms.
 *
 * Everything the plugin writes lives under `.dsh-ip-wiki/`, and `cards/` is written
 * in exactly one place — {@link confirmDraft} — after backing the replaced file up
 * so the write can be undone byte for byte. Because the reader and the retriever
 * only ever scan `cards/`, an unconfirmed draft is invisible to the model by
 * construction rather than by agreement.
 *
 * A card the migration wrote is `status: draft` until a human confirms it.
 * {@link proposeCardConfirmations} queues those cards as drafts whose only change
 * is that one frontmatter line, so the confirmation that gives a card its
 * `confirmed` status is itself reviewable, logged, and revertible.
 * @module dsh-ip-wiki/host/drafts
 */
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { CardType } from '../shared/card'
import { asCardStatus, asCardType } from '../shared/card'
import { diffCounts, diffLines, type DiffLine } from '../shared/diff'
import { parseFrontmatter, setFrontmatterFields, textField } from '../shared/frontmatter'
import { rebuildIndex } from './index-file'
import { INDEX_FILE, inside, resolveInside } from './library'
import { ARCHIVE_DIR, BACKUPS_DIR, DRAFTS_DIR, fileNames, logLine, writeAtomic } from './workdir'

/** Which material a draft was made from. */
export type MaterialClass = 'public' | 'client-material'

/** What produced the draft. */
export type GeneratedBy = 'human' | 'local-model' | 'dsh-model'

/** Which models may see this material. */
export type ModelPolicy = 'local-only' | 'dsh-model-allowed'

/** How the row may treat each material class. */
export interface SourcePolicy {
  /** What may read public material; defaults to `dsh-model`. */
  readonly public?: 'dsh-model' | 'local-model'
  /** What may read client material; defaults to `local-only`. */
  readonly clientMaterial?: 'local-only' | 'dsh-model'
}

/** What a caller asks for when drafting a card. */
export interface DraftRequest {
  /** Where the card would land, relative to the library root. */
  readonly path: string
  /** The whole card text the draft proposes: frontmatter plus body. */
  readonly content: string
  /** Where the material came from. */
  readonly classification: MaterialClass
  /** What produced the text. */
  readonly generatedBy: GeneratedBy
  /** File, URL, or session the material came from. */
  readonly sourceRef?: string
  /** A line for the reviewer. */
  readonly note?: string
  /**
   * Cards this draft absorbs, when it merges duplicates. Confirming the draft
   * marks each of them superseded, and reverting restores them.
   */
  readonly supersedes?: readonly string[]
}

/** What a draft does to the library. */
export type DraftKind = 'card' | 'merge' | 'status'

/** Why a card was not queued for a status confirmation. */
export type ConfirmSkip = 'already-confirmed' | 'deprecated'

/** One card queued for a status confirmation. */
export interface QueuedConfirmation {
  /** Discriminant. */
  readonly action: 'queued'
  /** The card the confirmation would touch. */
  readonly path: string
  /** The draft that carries the status change. */
  readonly id: string
}

/** One card the queue left alone. */
export interface SkippedConfirmation {
  /** Discriminant. */
  readonly action: 'skipped'
  /** The card the queue looked at. */
  readonly path: string
  /** Why nothing was queued for it. */
  readonly reason: ConfirmSkip
}

/** What queuing one card for a status confirmation did. */
export type CardConfirmProposal = QueuedConfirmation | SkippedConfirmation

/** Largest number of cards one confirmation batch may queue. */
const MAX_CONFIRM_PATHS = 300

/** The directory every confirmable card sits under. */
const CARD_PREFIX = 'cards/'

/** Where a status confirmation records that the request came from. */
const CONFIRM_SOURCE_REF = 'library:card-status'

/** The reviewer's line on a status-only draft. */
const CONFIRM_NOTE = '状态确认：只把这张卡片的 status 改为 confirmed，正文与其它字段一字不动；确认前请先看卡片内容与门禁结论。'

/** One stored draft. */
export interface CardDraft {
  /** Idempotency key: the same library, target, content, and absorbed set. */
  readonly id: string
  /** Whether the draft writes one card or merges several. */
  readonly kind: DraftKind
  /** Where the card would land. */
  readonly target: string
  /** Card kind, read from the draft's own frontmatter. */
  readonly type: CardType
  /** Card title, read from the draft's own frontmatter. */
  readonly title: string
  /** The whole card text. */
  readonly content: string
  /** Cards the confirm will mark superseded. */
  readonly supersedes: readonly string[]
  /** Which material the draft was made from. */
  readonly classification: MaterialClass
  /** What produced the text. */
  readonly generatedBy: GeneratedBy
  /** Which models this material permits. */
  readonly policy: ModelPolicy
  /** Where the material came from. */
  readonly sourceRef: string
  /** The reviewer's note. */
  readonly note: string
  /** When the draft was written. */
  readonly createdAt: string
  /** Where the draft stands. */
  readonly status: 'pending' | 'confirmed' | 'discarded'
  /** When it was confirmed, or `undefined`. */
  readonly confirmedAt: string | undefined
  /** When it was reverted, or `undefined`. */
  readonly revertedAt: string | undefined
}

/** One draft with what it would change. */
export interface DraftView {
  /** The draft. */
  readonly draft: CardDraft
  /** The difference against the card on disk, or against nothing for a new card. */
  readonly diff: readonly DiffLine[]
  /** How many lines the draft adds and removes. */
  readonly counts: { readonly added: number; readonly removed: number }
  /** Whether a card already sits at the target. */
  readonly existing: boolean
}

/** What a confirm did. */
export interface ConfirmResult {
  /** Where the card landed. */
  readonly path: string
  /** Whether the target was created or replaced. */
  readonly action: 'created' | 'replaced'
  /** The backup the revert would restore, or `undefined` for a created card. */
  readonly backup: string | undefined
  /** Cards the confirm marked superseded, in the order the draft listed them. */
  readonly deprecated: readonly string[]
}

/** What a revert did. */
export interface RevertResult {
  /** The card the revert touched. */
  readonly path: string
  /** Whether the previous card was restored or the created card deleted. */
  readonly action: 'restored' | 'deleted'
  /** Cards the revert restored from their superseded state. */
  readonly restored: readonly string[]
}

/** Read the card kind and title a draft's own frontmatter declares. */
function cardTypeOf(content: string): { readonly type: CardType; readonly title: string } {
  const { fields } = parseFrontmatter(content)
  const type = asCardType(textField(fields, 'type'))
  if (type === undefined) {
    throw new Error('dsh-ip-wiki: draft content must declare a card type (concept | rule | case | statute) in its frontmatter')
  }
  return { type, title: textField(fields, 'title') ?? '' }
}

/** Read one stored draft, or `undefined`. */
async function readStored(root: string, id: string): Promise<CardDraft | undefined> {
  for (const dir of [DRAFTS_DIR, ARCHIVE_DIR]) {
    const path = resolveInside(root, `${dir}/${id}.json`)
    if (path === undefined) continue
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (typeof parsed === 'object' && parsed !== null) return parsed as CardDraft
    } catch {
      // A draft file that cannot be read is not a draft: the caller gets a plain
      // "no such draft" rather than a half-parsed card.
      continue
    }
  }
  return undefined
}

/** Write one stored draft into a directory, replacing it. */
async function storeDraft(root: string, dir: string, draft: CardDraft): Promise<void> {
  const path = inside(root, dir, `${draft.id}.json`)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(draft, null, 2)}\n`)
}

/**
 * Decide which models this material permits, and refuse a combination the policy
 * forbids.
 * @param classification - where the material came from.
 * @param generatedBy - what produced the draft.
 * @param policy - the row's source policy, or `undefined` for the defaults.
 * @returns the verdict.
 * @throws {Error} when client material would be recorded as produced by a DSH model
 * under a `local-only` policy.
 */
export function policyFor(
  classification: MaterialClass,
  generatedBy: GeneratedBy,
  policy: SourcePolicy | undefined,
): ModelPolicy {
  const publicVerdict: ModelPolicy =
    (policy?.public ?? 'dsh-model') === 'dsh-model' ? 'dsh-model-allowed' : 'local-only'
  const clientVerdict: ModelPolicy =
    (policy?.clientMaterial ?? 'local-only') === 'dsh-model' ? 'dsh-model-allowed' : 'local-only'
  const verdict = classification === 'public' ? publicVerdict : clientVerdict
  if (verdict === 'local-only' && generatedBy === 'dsh-model') {
    throw new Error(
      `dsh-ip-wiki: ${classification} material is ${verdict} under this source policy, `
      + 'so a draft it produced cannot record generatedBy: dsh-model',
    )
  }
  return verdict
}

/**
 * The idempotency key of one draft, per the documented recipe.
 * @param root - absolute library root.
 * @param target - the card the draft writes.
 * @param content - the whole card text.
 * @param supersedes - the cards the draft absorbs, in the order given.
 * @returns the key.
 */
export function draftIdFor(
  root: string,
  target: string,
  content: string,
  supersedes: readonly string[] = [],
): string {
  const absorbed = [...supersedes].sort().join(',')
  return createHash('sha256').update(`${root}|${target}|${content}|${absorbed}`).digest('hex').slice(0, 16)
}

/** Where one draft's backup of one card lives. */
function backupPath(root: string, id: string, target: string): string {
  return inside(root, BACKUPS_DIR, id, ...target.split('/'))
}

/**
 * Check the cards a merge would absorb.
 * @param root - absolute library root.
 * @param target - the card the merge writes.
 * @param supersedes - the paths the draft listed.
 * @returns the paths, unchanged.
 * @throws {Error} when a path leaves the library, points at the draft's own card,
 * repeats, or names no card on disk.
 */
export async function checkSupersedes(
  root: string,
  target: string,
  supersedes: readonly string[],
): Promise<readonly string[]> {
  const seen = new Set<string>()
  for (const absorbed of supersedes) {
    const resolved = resolveInside(root, absorbed)
    if (resolved === undefined) {
      throw new Error(`dsh-ip-wiki: cannot absorb ${absorbed}: it is not a path inside the library`)
    }
    if (absorbed === target) {
      throw new Error(`dsh-ip-wiki: a merge cannot absorb the card it writes: ${absorbed}`)
    }
    if (seen.has(absorbed)) {
      throw new Error(`dsh-ip-wiki: a merge lists ${absorbed} twice`)
    }
    seen.add(absorbed)
    const info = await stat(resolved).catch(() => undefined)
    if (info === undefined || !info.isFile()) {
      throw new Error(`dsh-ip-wiki: cannot absorb ${absorbed}: there is no card at that path`)
    }
  }
  return supersedes
}

/**
 * Store a pending draft, or keep the identical one that is already pending.
 * @param root - absolute library root.
 * @param draft - the draft to store.
 * @returns the stored draft.
 */
async function queueDraft(root: string, draft: CardDraft): Promise<CardDraft> {
  const pending = await readStored(root, draft.id)
  if (pending?.status === 'pending') return pending
  await storeDraft(root, DRAFTS_DIR, draft)
  await logLine(root, `draft ${draft.id} ${draft.target} ${draft.classification}/${draft.generatedBy} policy=${draft.policy}`)
  return draft
}

/**
 * Store a draft, or return the identical one that is already pending.
 * @param root - absolute library root.
 * @param request - what to draft.
 * @param policy - the row's source policy.
 * @returns the stored draft.
 * @throws {Error} when the target is outside `cards/`, its kind does not match the
 * frontmatter, or the source policy forbids the recorded origin.
 */
export async function writeDraft(
  root: string,
  request: DraftRequest,
  policy: SourcePolicy | undefined,
): Promise<CardDraft> {
  const { type, title } = cardTypeOf(request.content)
  const target = resolveInside(root, request.path)
  const expected = `cards/${type}/`
  if (target === undefined || !request.path.startsWith(expected) || !request.path.endsWith('.md')) {
    throw new Error(`dsh-ip-wiki: draft target must be a .md file under ${expected}, got ${request.path}`)
  }
  const verdict = policyFor(request.classification, request.generatedBy, policy)
  const supersedes = await checkSupersedes(root, request.path, request.supersedes ?? [])
  const draft: CardDraft = {
    id: draftIdFor(root, request.path, request.content, supersedes),
    kind: supersedes.length === 0 ? 'card' : 'merge',
    target: request.path,
    type,
    title,
    content: request.content,
    supersedes,
    classification: request.classification,
    generatedBy: request.generatedBy,
    policy: verdict,
    sourceRef: request.sourceRef ?? '',
    note: request.note ?? '',
    createdAt: new Date().toISOString(),
    status: 'pending',
    confirmedAt: undefined,
    revertedAt: undefined,
  }
  return queueDraft(root, draft)
}

/** Every pending draft, oldest first. */
export async function listDrafts(root: string): Promise<CardDraft[]> {
  const drafts: CardDraft[] = []
  for (const file of await fileNames(inside(root, DRAFTS_DIR), '.json')) {
    const draft = await readStored(root, basename(file, '.json'))
    if (draft !== undefined && draft.status === 'pending') drafts.push(draft)
  }
  // Ids break a timestamp tie, so the order is the same on every read.
  return drafts.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
}

/**
 * Build one draft's view from the card on disk.
 *
 * A status confirmation is derived from the card as it is now rather than from the
 * text it was queued from, so its difference is always the one line the confirm
 * would really change.
 * @param root - absolute library root.
 * @param draft - the draft to describe.
 * @returns the view.
 */
async function viewFor(root: string, draft: CardDraft): Promise<DraftView> {
  const target = resolveInside(root, draft.target)
  let before = ''
  if (target !== undefined) {
    const info = await stat(target).catch(() => undefined)
    if (info !== undefined && info.isFile()) before = await readFile(target, 'utf8')
  }
  const after = draft.kind === 'status' && before !== '' ? confirmedText(before) : draft.content
  const diff = diffLines(before, after)
  return { draft, diff, counts: diffCounts(diff), existing: before !== '' }
}

/**
 * Read one draft with the difference it would make.
 * @param root - absolute library root.
 * @param id - the draft id.
 * @returns the view, or `undefined` when no such draft exists.
 */
export async function viewDraft(root: string, id: string): Promise<DraftView | undefined> {
  const draft = await readStored(root, id)
  return draft === undefined ? undefined : viewFor(root, draft)
}

/**
 * Store a draft and describe the difference it would make.
 * @param root - absolute library root.
 * @param request - what to draft.
 * @param policy - the row's source policy.
 * @returns the stored draft with its difference.
 */
export async function proposeDraft(
  root: string,
  request: DraftRequest,
  policy: SourcePolicy | undefined,
): Promise<DraftView> {
  return viewFor(root, await writeDraft(root, request, policy))
}

/**
 * Queue the library's unconfirmed cards for a status confirmation.
 *
 * Confirming a card is a one-line frontmatter change — `status: draft` becomes
 * `status: confirmed` — so it travels the same road as every other write: a draft
 * under `.dsh-ip-wiki/`, confirmed by the panel or {@link confirmDraft}, backed up
 * before the write and revertible after it. A card that is already confirmed or
 * deprecated is reported as skipped rather than queued again.
 * @param root - absolute library root.
 * @param paths - the cards to queue, in the order to report them.
 * @param policy - the row's source policy.
 * @returns one verdict per path.
 * @throws {Error} when a path is not a `.md` card under `cards/`, names no file on
 * disk, or the batch is larger than {@link MAX_CONFIRM_PATHS}.
 */
export async function proposeCardConfirmations(
  root: string,
  paths: readonly string[],
  policy: SourcePolicy | undefined,
): Promise<readonly CardConfirmProposal[]> {
  if (paths.length > MAX_CONFIRM_PATHS) {
    throw new Error(
      `dsh-ip-wiki: one confirmation batch carries at most ${String(MAX_CONFIRM_PATHS)} cards, got ${String(paths.length)}`,
    )
  }
  const proposals: CardConfirmProposal[] = []
  for (const path of paths) proposals.push(await proposeCardConfirmation(root, path, policy))
  return proposals
}

/** Queue one card for its status confirmation. */
async function proposeCardConfirmation(
  root: string,
  path: string,
  policy: SourcePolicy | undefined,
): Promise<CardConfirmProposal> {
  const target = resolveInside(root, path)
  if (target === undefined || !path.startsWith(CARD_PREFIX) || !path.endsWith('.md')) {
    throw new Error(`dsh-ip-wiki: a card to confirm must be a .md file under ${CARD_PREFIX}, got ${path}`)
  }
  const source = await readFile(target, 'utf8').catch(() => undefined)
  if (source === undefined) throw new Error(`dsh-ip-wiki: cannot confirm ${path}: there is no card at that path`)
  const status = asCardStatus(textField(parseFrontmatter(source).fields, 'status'))
  if (status !== 'draft') {
    return { action: 'skipped', path, reason: status === 'confirmed' ? 'already-confirmed' : 'deprecated' }
  }
  const { type, title } = cardTypeOf(source)
  return {
    action: 'queued',
    path,
    id: (await queueDraft(root, {
      id: statusDraftIdFor(root, path),
      kind: 'status',
      target: path,
      type,
      title,
      content: confirmedText(source),
      supersedes: [],
      classification: 'public',
      generatedBy: 'human',
      policy: policyFor('public', 'human', policy),
      sourceRef: CONFIRM_SOURCE_REF,
      note: CONFIRM_NOTE,
      createdAt: new Date().toISOString(),
      status: 'pending',
      confirmedAt: undefined,
      revertedAt: undefined,
    })).id,
  }
}

/**
 * The idempotency key of one status confirmation: the card, not its text.
 *
 * A confirmation is derived from the card at confirm time, so re-queuing a card
 * whose body changed has to reach the same pending draft instead of a second one.
 * @param root - absolute library root.
 * @param target - the card the confirmation would touch.
 * @returns the key.
 */
function statusDraftIdFor(root: string, target: string): string {
  return createHash('sha256').update(`${root}|${target}|status:confirmed`).digest('hex').slice(0, 16)
}

/**
 * The card text a status confirmation writes.
 * @param source - the card as it is on disk.
 * @returns the same text with the status line flipped to `confirmed`.
 * @throws {Error} when the card carries no frontmatter block to edit.
 */
function confirmedText(source: string): string {
  return setFrontmatterFields(source, { status: '"confirmed"' })
}

/**
 * Write one draft's card into the library.
 * @param root - absolute library root.
 * @param id - the draft id.
 * @returns what the write did.
 * @throws {Error} when the draft is unknown, is not pending, or is a status
 * confirmation whose card is no longer on disk.
 */
export async function confirmDraft(root: string, id: string): Promise<ConfirmResult> {
  const draft = await readStored(root, id)
  if (draft === undefined) throw new Error(`dsh-ip-wiki: no draft ${id}`)
  if (draft.status !== 'pending') throw new Error(`dsh-ip-wiki: draft ${id} is ${draft.status}, not pending`)
  const target = resolveInside(root, draft.target)
  if (target === undefined) throw new Error(`dsh-ip-wiki: draft ${id} targets a path outside the library: ${draft.target}`)
  const info = await stat(target).catch(() => undefined)
  const exists = info !== undefined && info.isFile()
  // A status confirmation transforms the card that is there now rather than
  // restoring the text it was queued from, so it can only ever change the status
  // line even when the body was rewritten while the draft waited.
  if (draft.kind === 'status' && !exists) {
    throw new Error(`dsh-ip-wiki: cannot confirm ${draft.target}: a status confirmation needs the card on disk, and there is none`)
  }
  let backup: string | undefined
  if (exists) {
    const copy = backupPath(root, id, draft.target)
    await mkdir(dirname(copy), { recursive: true })
    await copyFile(target, copy)
    backup = `${BACKUPS_DIR}/${id}/${draft.target}`
  }
  await writeAtomic(target, draft.kind === 'status' ? confirmedText(await readFile(target, 'utf8')) : draft.content)
  // The absorbed cards are marked after the survivor exists, so a crash leaves a
  // duplicate pair rather than cards pointing at a card that was never written.
  const deprecated: string[] = []
  for (const absorbed of draft.supersedes) {
    const path = resolveInside(root, absorbed)
    if (path === undefined) continue
    const before = await readFile(path, 'utf8')
    const copy = backupPath(root, id, absorbed)
    await mkdir(dirname(copy), { recursive: true })
    await copyFile(path, copy)
    await writeAtomic(path, setFrontmatterFields(before, {
      status: '"deprecated"',
      superseded_by: `"${draft.target}"`,
    }))
    deprecated.push(absorbed)
    await logLine(root, `supersede ${id} ${absorbed} -> ${draft.target}`)
  }
  const confirmed: CardDraft = { ...draft, status: 'confirmed', confirmedAt: new Date().toISOString() }
  await rm(inside(root, DRAFTS_DIR, `${id}.json`), { force: true })
  await storeDraft(root, ARCHIVE_DIR, confirmed)
  await logLine(root, `confirm ${id} ${draft.target} ${exists ? 'replaced' : 'created'}`)
  // The index is a derived artifact of the cards, so the write that changed the
  // cards refreshes it. Its previous bytes join this draft's backups: a revert has
  // to put the library back exactly as it was, and the index is part of that.
  // A rebuild that fails is logged, not fatal: the gate reports the drift, and the
  // panel can rebuild on demand.
  const index = inside(root, INDEX_FILE)
  const indexBefore = await readFile(index, 'utf8').catch(() => undefined)
  if (indexBefore !== undefined) await writeAtomic(backupPath(root, id, INDEX_FILE), indexBefore)
  await rebuildIndex(root)
    .then(result => logLine(root, `index rebuilt after confirm ${id}: ${String(result.totalCards)} cards`))
    .catch((cause: unknown) => logLine(root, `index rebuild failed after confirm ${id}: ${String(cause)}`))
  return { path: draft.target, action: exists ? 'replaced' : 'created', backup, deprecated }
}

/**
 * Set one draft aside without writing its card.
 * @param root - absolute library root.
 * @param id - the draft id.
 * @throws {Error} when the draft is unknown or is not pending.
 */
export async function discardDraft(root: string, id: string): Promise<void> {
  const draft = await readStored(root, id)
  if (draft === undefined) throw new Error(`dsh-ip-wiki: no draft ${id}`)
  if (draft.status !== 'pending') throw new Error(`dsh-ip-wiki: draft ${id} is ${draft.status}, not pending`)
  await rm(inside(root, DRAFTS_DIR, `${id}.json`), { force: true })
  await storeDraft(root, ARCHIVE_DIR, { ...draft, status: 'discarded' })
  await logLine(root, `discard ${id} ${draft.target}`)
}

/**
 * Undo one confirmed draft.
 * @param root - absolute library root.
 * @param id - the draft id.
 * @returns what the revert did.
 * @throws {Error} when the draft was never confirmed, was already reverted, or the
 * backup it needs is gone.
 */
export async function revertDraft(root: string, id: string): Promise<RevertResult> {
  const draft = await readStored(root, id)
  if (draft === undefined) throw new Error(`dsh-ip-wiki: no draft ${id}`)
  if (draft.status !== 'confirmed') throw new Error(`dsh-ip-wiki: draft ${id} is ${draft.status}; only a confirmed draft can be reverted`)
  if (draft.revertedAt !== undefined) throw new Error(`dsh-ip-wiki: draft ${id} was already reverted`)
  const target = resolveInside(root, draft.target)
  if (target === undefined) throw new Error(`dsh-ip-wiki: draft ${id} targets a path outside the library: ${draft.target}`)
  const restored: string[] = []
  for (const absorbed of draft.supersedes) {
    const path = resolveInside(root, absorbed)
    if (path === undefined) continue
    const saved = await stat(backupPath(root, id, absorbed)).catch(() => undefined)
    if (saved === undefined || !saved.isFile()) continue
    await copyFile(backupPath(root, id, absorbed), path)
    restored.push(absorbed)
    await logLine(root, `unsupersede ${id} ${absorbed}`)
  }
  const saved = await stat(backupPath(root, id, draft.target)).catch(() => undefined)
  let action: 'restored' | 'deleted'
  if (saved !== undefined && saved.isFile()) {
    await copyFile(backupPath(root, id, draft.target), target)
    action = 'restored'
  } else {
    await rm(target, { force: true })
    action = 'deleted'
  }
  // The derived index goes back too. No backup means the confirm created it, so the
  // state to restore is "there was no index".
  const indexBackup = backupPath(root, id, INDEX_FILE)
  const indexCopy = await readFile(indexBackup, 'utf8').catch(() => undefined)
  if (indexCopy === undefined) await rm(inside(root, INDEX_FILE), { force: true })
  else await writeAtomic(inside(root, INDEX_FILE), indexCopy)
  // Restoring the kept index is the whole job: those bytes describe exactly this
  // card set, so rebuilding here would only rewrite them with a new timestamp.
  await storeDraft(root, ARCHIVE_DIR, { ...draft, revertedAt: new Date().toISOString() })
  await logLine(root, `revert ${id} ${draft.target} ${action}`)
  return { path: draft.target, action, restored }
}
