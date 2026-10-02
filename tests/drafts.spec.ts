/** The line difference and the draft store: what it writes, what it refuses, and what it can undo. */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { relative, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { readLintReport } from '../src/host/lint'
import { diffCounts, diffLines } from '../src/shared/diff'
import {
  checkSupersedes,
  confirmDraft,
  discardDraft,
  draftIdFor,
  listDrafts,
  policyFor,
  proposeCardConfirmations,
  revertDraft,
  viewDraft,
  writeDraft,
  type DraftRequest,
} from '../src/host/drafts'
import { makeLibrary, type FixtureLibrary } from './fixtures'

/** Libraries created by the running test, removed afterwards. */
const created: FixtureLibrary[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map(async fixture => { await fixture.dispose() }))
})

/**
 * Write a throwaway library.
 * @returns the fixture.
 */
async function library(): Promise<FixtureLibrary> {
  const fixture = await makeLibrary()
  created.push(fixture)
  return fixture
}

/** A card text a draft can propose. */
function cardText(title: string, body = '正文。'): string {
  return `---\nid: "new"\ntype: "rule"\ntitle: "${title}"\ndomain_l2: "OA 答复"\n---\n\n# ${title}\n\n${body}\n`
}

/** A draft request for one new card. */
function request(overrides: Partial<DraftRequest> = {}): DraftRequest {
  return {
    path: 'cards/rule/proposed.md',
    content: cardText('拟新增的规则卡'),
    classification: 'public',
    generatedBy: 'local-model',
    ...overrides,
  }
}

describe('diffLines', () => {
  it('reports identical texts as unchanged', () => {
    expect(diffLines('a\nb\n', 'a\nb\n')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
    ])
  })

  it('reports a new file as all added', () => {
    expect(diffLines('', 'a\nb')).toEqual([
      { kind: 'added', text: 'a' },
      { kind: 'added', text: 'b' },
    ])
  })

  it('reports a deleted file as all removed', () => {
    expect(diffLines('a\nb', '')).toEqual([
      { kind: 'removed', text: 'a' },
      { kind: 'removed', text: 'b' },
    ])
  })

  it('names the added line inside an unchanged frame', () => {
    expect(diffLines('a\nc\n', 'a\nb\nc\n')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'added', text: 'b' },
      { kind: 'same', text: 'c' },
    ])
  })

  it('names the removed line inside an unchanged frame', () => {
    expect(diffLines('a\nb\nc\n', 'a\nc\n')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'same', text: 'c' },
    ])
  })

  it('replaces a changed line in place', () => {
    expect(diffLines('a\nold\nc\n', 'a\nnew\nc\n')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'old' },
      { kind: 'added', text: 'new' },
      { kind: 'same', text: 'c' },
    ])
  })

  it('counts what it reported', () => {
    expect(diffCounts(diffLines('a\nb', 'a\nc\nd'))).toEqual({ added: 2, removed: 1 })
  })
})

describe('policyFor', () => {
  it('allows a DSH model on public material by default', () => {
    expect(policyFor('public', 'dsh-model', undefined)).toBe('dsh-model-allowed')
  })

  it('keeps client material local by default and refuses a DSH-model origin', () => {
    expect(policyFor('client-material', 'local-model', undefined)).toBe('local-only')
    expect(() => policyFor('client-material', 'dsh-model', undefined))
      .toThrow(/local-only under this source policy/u)
  })

  it('reads the row policy for both classes', () => {
    expect(policyFor('public', 'local-model', { public: 'local-model' })).toBe('local-only')
    expect(policyFor('client-material', 'dsh-model', { clientMaterial: 'dsh-model' })).toBe('dsh-model-allowed')
  })

  it('lets a human draft client material under any policy', () => {
    expect(policyFor('client-material', 'human', undefined)).toBe('local-only')
  })
})

describe('draftIdFor', () => {
  it('is stable for the same library, target, and content', () => {
    expect(draftIdFor('/lib', 'cards/rule/a.md', 'x')).toBe(draftIdFor('/lib', 'cards/rule/a.md', 'x'))
  })

  it('changes with the library, the target, or the content', () => {
    const base = draftIdFor('/lib', 'cards/rule/a.md', 'x')
    expect(draftIdFor('/other', 'cards/rule/a.md', 'x')).not.toBe(base)
    expect(draftIdFor('/lib', 'cards/rule/b.md', 'x')).not.toBe(base)
    expect(draftIdFor('/lib', 'cards/rule/a.md', 'y')).not.toBe(base)
  })
})

describe('writeDraft', () => {
  it('stores a pending draft and writes the log line', async () => {
    const fixture = await library()
    const draft = await writeDraft(fixture.root, request({ sourceRef: '/in.pdf', note: '来自 PDF' }), undefined)
    expect(draft.status).toBe('pending')
    expect(draft.target).toBe('cards/rule/proposed.md')
    expect(draft.type).toBe('rule')
    expect(draft.title).toBe('拟新增的规则卡')
    expect(draft.policy).toBe('dsh-model-allowed')
    expect(draft.sourceRef).toBe('/in.pdf')
    expect(draft.note).toBe('来自 PDF')
    const log = await readFile(join(fixture.root, '.dsh-ip-wiki', 'log.md'), 'utf8')
    expect(log).toContain(`draft ${draft.id} cards/rule/proposed.md public/local-model`)
    await expect(listDrafts(fixture.root)).resolves.toHaveLength(1)
  })

  it('returns the pending draft it already holds for identical input', async () => {
    const fixture = await library()
    const first = await writeDraft(fixture.root, request(), undefined)
    const again = await writeDraft(fixture.root, request(), undefined)
    expect(again.id).toBe(first.id)
    expect(again.createdAt).toBe(first.createdAt)
    await expect(listDrafts(fixture.root)).resolves.toHaveLength(1)
  })

  it('refuses content with no card type', async () => {
    const fixture = await library()
    await expect(writeDraft(fixture.root, request({ content: '---\ntitle: 无型\n---\n正文\n' }), undefined))
      .rejects.toThrow(/must declare a card type/u)
  })

  it('refuses a target that does not match the declared type', async () => {
    const fixture = await library()
    await expect(writeDraft(fixture.root, request({ path: 'cards/concept/proposed.md' }), undefined))
      .rejects.toThrow(/must be a \.md file under cards\/rule\//u)
  })

  it('refuses a target outside the card tree', async () => {
    const fixture = await library()
    await expect(writeDraft(fixture.root, request({ path: 'notes/proposed.md' }), undefined))
      .rejects.toThrow(/must be a \.md file under cards\/rule\//u)
    await expect(writeDraft(fixture.root, request({ path: '../escape.md' }), undefined))
      .rejects.toThrow(/must be a \.md file under cards\/rule\//u)
  })

  it('reads a draft that declares no title as an untitled one', async () => {
    const fixture = await library()
    const draft = await writeDraft(fixture.root, request({
      content: '---\ntype: "rule"\n---\n\n# 正文标题\n\n正文。\n',
    }), undefined)
    expect(draft.title).toBe('')
  })

  it('refuses the origin the source policy forbids', async () => {
    const fixture = await library()
    await expect(writeDraft(fixture.root, request({ classification: 'client-material', generatedBy: 'dsh-model' }), undefined))
      .rejects.toThrow(/cannot record generatedBy: dsh-model/u)
  })
})

describe('viewDraft', () => {
  it('shows a new card as all added', async () => {
    const fixture = await library()
    const draft = await writeDraft(fixture.root, request(), undefined)
    const view = await viewDraft(fixture.root, draft.id)
    expect(view?.existing).toBe(false)
    expect(view?.counts.removed).toBe(0)
    expect(view?.diff.every(line => line.kind === 'added')).toBe(true)
  })

  it('shows a replacement as a difference against the card on disk', async () => {
    const fixture = await library()
    const draft = await writeDraft(fixture.root, request({ path: 'cards/rule/rule-1.md' }), undefined)
    const view = await viewDraft(fixture.root, draft.id)
    expect(view?.existing).toBe(true)
    expect(view?.diff.some(line => line.kind === 'removed')).toBe(true)
  })

  it('answers an unknown draft with nothing', async () => {
    const fixture = await library()
    await expect(viewDraft(fixture.root, 'nope')).resolves.toBeUndefined()
  })

  it('answers a draft id that climbs out of the library with nothing', async () => {
    const fixture = await library()
    await expect(viewDraft(fixture.root, '../../../../outside')).resolves.toBeUndefined()
  })

  it('ignores a draft file that cannot be parsed', async () => {
    const fixture = await library()
    const dir = join(fixture.root, '.dsh-ip-wiki', 'drafts')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'bad.json'), 'not json')
    await expect(viewDraft(fixture.root, 'bad')).resolves.toBeUndefined()
  })

  it('reads a draft whose stored target escapes the library as a new file', async () => {
    const fixture = await library()
    const draft = await writeDraft(fixture.root, request(), undefined)
    await writeFile(join(fixture.root, '.dsh-ip-wiki', 'drafts', `${draft.id}.json`),
      JSON.stringify({ ...draft, target: '../outside.md' }))
    const view = await viewDraft(fixture.root, draft.id)
    expect(view?.existing).toBe(false)
  })
})

describe('listDrafts', () => {
  it('answers an empty store with no drafts', async () => {
    const fixture = await library()
    await expect(listDrafts(fixture.root)).resolves.toEqual([])
  })

  it('breaks a creation-time tie by id, so the order is the same on every read', async () => {
    const fixture = await library()
    const one = await writeDraft(fixture.root, request({ path: 'cards/rule/a.md', content: cardText('甲') }), undefined)
    const two = await writeDraft(fixture.root, request({ path: 'cards/rule/b.md', content: cardText('乙') }), undefined)
    // Both drafts now claim the same creation time, as two writes in one millisecond do.
    const stored = join(fixture.root, '.dsh-ip-wiki', 'drafts', `${two.id}.json`)
    const edited = JSON.parse(await readFile(stored, 'utf8')) as Record<string, unknown>
    await writeFile(stored, JSON.stringify({ ...edited, createdAt: one.createdAt }))
    const drafts = await listDrafts(fixture.root)
    expect(drafts.map(draft => draft.id)).toEqual([one.id, two.id].sort((left, right) => left.localeCompare(right)))
    expect(await listDrafts(fixture.root)).toEqual(drafts)
  })

  it('ignores files that are not drafts, and orders by creation', async () => {
    const fixture = await library()
    const second = await writeDraft(fixture.root, request({ path: 'cards/rule/b.md', content: cardText('乙') }), undefined)
    // Distinct creation times: two drafts written in the same millisecond tie, and
    // "oldest first" is then unobservable.
    await delay(5)
    const first = await writeDraft(fixture.root, request({ path: 'cards/rule/a.md', content: cardText('甲') }), undefined)
    await writeFile(join(fixture.root, '.dsh-ip-wiki', 'drafts', 'notes.txt'), 'ignore me')
    const drafts = await listDrafts(fixture.root)
    expect(drafts.map(draft => draft.id)).toEqual([second.id, first.id])
    expect(drafts.map(draft => draft.title)).toEqual(['乙', '甲'])
  })
})

describe('confirmDraft', () => {
  it('creates a card and records the write', async () => {
    const fixture = await library()
    const draft = await writeDraft(fixture.root, request(), undefined)
    await expect(confirmDraft(fixture.root, draft.id))
      .resolves.toEqual({ path: 'cards/rule/proposed.md', action: 'created', backup: undefined, deprecated: [] })
    const landed = await readFile(join(fixture.root, 'cards/rule/proposed.md'), 'utf8')
    expect(landed).toBe(draft.content)
    expect(await listDrafts(fixture.root)).toEqual([])
    const log = await readFile(join(fixture.root, '.dsh-ip-wiki', 'log.md'), 'utf8')
    expect(log).toContain(`confirm ${draft.id} cards/rule/proposed.md created`)
  })

  it('replaces a card and keeps the file it replaced', async () => {
    const fixture = await library()
    const before = await readFile(fixture.rulePath, 'utf8')
    const draft = await writeDraft(fixture.root, request({ path: 'cards/rule/rule-1.md' }), undefined)
    const done = await confirmDraft(fixture.root, draft.id)
    expect(done.action).toBe('replaced')
    expect(done.backup).toBe(`.dsh-ip-wiki/backups/${draft.id}/cards/rule/rule-1.md`)
    const backup = await readFile(join(fixture.root, '.dsh-ip-wiki', 'backups', draft.id, 'cards', 'rule', 'rule-1.md'), 'utf8')
    expect(backup).toBe(before)
    expect(await readFile(fixture.rulePath, 'utf8')).toBe(draft.content)
  })

  it('refuses an unknown draft', async () => {
    const fixture = await library()
    await expect(confirmDraft(fixture.root, 'nope')).rejects.toThrow('no draft nope')
  })

  it('refuses a draft that is no longer pending', async () => {
    const fixture = await library()
    const draft = await writeDraft(fixture.root, request(), undefined)
    await confirmDraft(fixture.root, draft.id)
    await expect(confirmDraft(fixture.root, draft.id)).rejects.toThrow(/is confirmed, not pending/u)
  })

  it('refuses a draft whose stored target escapes the library', async () => {
    const fixture = await library()
    const draft = await writeDraft(fixture.root, request(), undefined)
    await writeFile(join(fixture.root, '.dsh-ip-wiki', 'drafts', `${draft.id}.json`),
      JSON.stringify({ ...draft, target: '../outside.md' }))
    await expect(confirmDraft(fixture.root, draft.id)).rejects.toThrow(/targets a path outside the library/u)
  })
})

describe('discardDraft', () => {
  it('sets a draft aside without writing a card', async () => {
    const fixture = await library()
    const draft = await writeDraft(fixture.root, request(), undefined)
    await discardDraft(fixture.root, draft.id)
    await expect(stat(join(fixture.root, 'cards/rule/proposed.md'))).rejects.toThrow()
    await expect(listDrafts(fixture.root)).resolves.toEqual([])
    const log = await readFile(join(fixture.root, '.dsh-ip-wiki', 'log.md'), 'utf8')
    expect(log).toContain(`discard ${draft.id}`)
  })

  it('refuses an unknown draft and one already decided', async () => {
    const fixture = await library()
    await expect(discardDraft(fixture.root, 'nope')).rejects.toThrow('no draft nope')
    const draft = await writeDraft(fixture.root, request(), undefined)
    await discardDraft(fixture.root, draft.id)
    await expect(discardDraft(fixture.root, draft.id)).rejects.toThrow(/is discarded, not pending/u)
  })
})

describe('revertDraft', () => {
  it('deletes the card a draft created', async () => {
    const fixture = await library()
    const draft = await writeDraft(fixture.root, request(), undefined)
    await confirmDraft(fixture.root, draft.id)
    await expect(revertDraft(fixture.root, draft.id))
      .resolves.toEqual({ path: 'cards/rule/proposed.md', action: 'deleted', restored: [] })
    await expect(stat(join(fixture.root, 'cards/rule/proposed.md'))).rejects.toThrow()
  })

  it('restores the card a draft replaced, byte for byte', async () => {
    const fixture = await library()
    const before = await readFile(fixture.rulePath, 'utf8')
    const draft = await writeDraft(fixture.root, request({ path: 'cards/rule/rule-1.md' }), undefined)
    await confirmDraft(fixture.root, draft.id)
    await expect(revertDraft(fixture.root, draft.id))
      .resolves.toEqual({ path: 'cards/rule/rule-1.md', action: 'restored', restored: [] })
    expect(await readFile(fixture.rulePath, 'utf8')).toBe(before)
    const log = await readFile(join(fixture.root, '.dsh-ip-wiki', 'log.md'), 'utf8')
    expect(log).toContain(`revert ${draft.id} cards/rule/rule-1.md restored`)
  })

  it('deletes the card when the backup is gone', async () => {
    const fixture = await library()
    const draft = await writeDraft(fixture.root, request({ path: 'cards/rule/rule-1.md' }), undefined)
    await confirmDraft(fixture.root, draft.id)
    await rm(join(fixture.root, '.dsh-ip-wiki', 'backups', draft.id), { recursive: true, force: true })
    await expect(revertDraft(fixture.root, draft.id))
      .resolves.toEqual({ path: 'cards/rule/rule-1.md', action: 'deleted', restored: [] })
  })

  it('refuses an unknown draft, an unconfirmed one, and a second revert', async () => {
    const fixture = await library()
    await expect(revertDraft(fixture.root, 'nope')).rejects.toThrow('no draft nope')
    const pending = await writeDraft(fixture.root, request(), undefined)
    await expect(revertDraft(fixture.root, pending.id)).rejects.toThrow(/only a confirmed draft can be reverted/u)
    await confirmDraft(fixture.root, pending.id)
    await revertDraft(fixture.root, pending.id)
    await expect(revertDraft(fixture.root, pending.id)).rejects.toThrow(/was already reverted/u)
  })

  it('refuses a draft whose stored target escapes the library', async () => {
    const fixture = await library()
    const draft = await writeDraft(fixture.root, request(), undefined)
    await confirmDraft(fixture.root, draft.id)
    const archived = join(fixture.root, '.dsh-ip-wiki', 'archive', `${draft.id}.json`)
    const stored = JSON.parse(await readFile(archived, 'utf8')) as Record<string, unknown>
    await writeFile(archived, JSON.stringify({ ...stored, target: '../outside.md' }))
    await expect(revertDraft(fixture.root, draft.id)).rejects.toThrow(/targets a path outside the library/u)
  })
})

describe('the derived index', () => {
  it('is refreshed by a confirm and by a revert', async () => {
    const fixture = await library()
    const original = JSON.parse(await readFile(join(fixture.root, 'index', 'card-index.json'), 'utf8')) as Record<string, unknown>
    const draft = await writeDraft(fixture.root, request({ path: 'cards/rule/proposed.md' }), undefined)
    await confirmDraft(fixture.root, draft.id)
    const confirmed = JSON.parse(await readFile(join(fixture.root, 'index', 'card-index.json'), 'utf8')) as Record<string, unknown>
    expect(confirmed['total_cards']).toBe(3)
    await expect(readLintReport(fixture.root, 'warning')).resolves.toMatchObject({ scanned: 3 })
    const drift = (await readLintReport(fixture.root, 'warning')).findings.map(finding => finding.code)
    expect(drift).not.toContain('index-drift')

    await revertDraft(fixture.root, draft.id)
    // The revert puts back the index bytes the confirm kept, so the count is the
    // pre-confirm one and the file is what it was before the write.
    const reverted = JSON.parse(await readFile(join(fixture.root, 'index', 'card-index.json'), 'utf8')) as Record<string, unknown>
    expect(reverted['total_cards']).toBe(2)
    expect(reverted['generated_at']).toBe(original['generated_at'])
    const log = await readFile(join(fixture.root, '.dsh-ip-wiki', 'log.md'), 'utf8')
    expect(log).toContain('index rebuilt after confirm')
  })

  it('removes an index a confirm created, because there was none before it', async () => {
    const fixture = await makeLibrary({ omitIndex: true })
    const draft = await writeDraft(fixture.root, request({ path: 'cards/rule/proposed.md' }), undefined)
    await confirmDraft(fixture.root, draft.id)
    await expect(stat(join(fixture.root, 'index', 'card-index.json'))).resolves.toBeDefined()
    await revertDraft(fixture.root, draft.id)
    await expect(stat(join(fixture.root, 'index', 'card-index.json'))).rejects.toThrow()
  })
})

describe('merge drafts', () => {
  /** The library-relative path of one card. */
  function rel(root: string, absolute: string): string {
    return relative(root, absolute).split(sep).join('/')
  }

  it('marks the absorbed cards superseded and restores them on revert', async () => {
    const fixture = await library()
    const absorbed = [rel(fixture.root, fixture.rulePath), rel(fixture.root, fixture.conceptPath)]
    const before = new Map<string, string>()
    for (const path of absorbed) before.set(path, await readFile(join(fixture.root, path), 'utf8'))

    const draft = await writeDraft(fixture.root, {
      ...request({ path: 'cards/rule/merged.md' }),
      supersedes: absorbed,
    }, undefined)
    expect(draft.kind).toBe('merge')
    expect(draft.supersedes).toEqual(absorbed)

    const done = await confirmDraft(fixture.root, draft.id)
    expect(done.deprecated).toEqual(absorbed)
    for (const path of absorbed) {
      const marked = await readFile(join(fixture.root, path), 'utf8')
      expect(marked).toContain('status: "deprecated"')
      expect(marked).toContain('superseded_by: "cards/rule/merged.md"')
      // Every byte outside the frontmatter line that changed is untouched.
      expect(marked.split('---').slice(2).join('---'))
        .toBe((before.get(path) ?? '').split('---').slice(2).join('---'))
    }
    const log = await readFile(join(fixture.root, '.dsh-ip-wiki', 'log.md'), 'utf8')
    expect(log).toContain(`supersede ${draft.id} ${absorbed[0] ?? ''} -> cards/rule/merged.md`)

    const undone = await revertDraft(fixture.root, draft.id)
    expect(undone.restored).toEqual(absorbed)
    for (const path of absorbed) {
      expect(await readFile(join(fixture.root, path), 'utf8')).toBe(before.get(path))
    }
    await expect(stat(join(fixture.root, 'cards/rule/merged.md'))).rejects.toThrow()
  })

  it('refuses to absorb a missing card, its own card, a path outside, or the same card twice', async () => {
    const fixture = await library()
    const rule = rel(fixture.root, fixture.rulePath)
    const merge = { ...request({ path: 'cards/rule/merged.md' }) }
    await expect(writeDraft(fixture.root, { ...merge, supersedes: ['cards/rule/gone.md'] }, undefined))
      .rejects.toThrow(/there is no card at that path/u)
    await expect(writeDraft(fixture.root, { ...merge, supersedes: ['cards/rule/merged.md'] }, undefined))
      .rejects.toThrow(/cannot absorb the card it writes/u)
    await expect(writeDraft(fixture.root, { ...merge, supersedes: ['../../outside.md'] }, undefined))
      .rejects.toThrow(/not a path inside the library/u)
    await expect(writeDraft(fixture.root, { ...merge, supersedes: [rule, rule] }, undefined))
      .rejects.toThrow(/lists cards\/rule\/rule-1.md twice/u)
  })

  it('skips an absorbed path that a hand-edited draft moved outside the library', async () => {
    const fixture = await library()
    const absorbed = [rel(fixture.root, fixture.rulePath)]
    const draft = await writeDraft(fixture.root, {
      ...request({ path: 'cards/rule/merged.md' }),
      supersedes: absorbed,
    }, undefined)
    const stored = join(fixture.root, '.dsh-ip-wiki', 'drafts', `${draft.id}.json`)
    const edited = JSON.parse(await readFile(stored, 'utf8')) as Record<string, unknown>
    await writeFile(stored, JSON.stringify({ ...edited, supersedes: ['../outside.md'] }))

    const done = await confirmDraft(fixture.root, draft.id)
    expect(done.deprecated).toEqual([])
    expect(await readFile(join(fixture.root, 'cards/rule/merged.md'), 'utf8')).toBe(draft.content)

    const undone = await revertDraft(fixture.root, draft.id)
    expect(undone.restored).toEqual([])
  })

  it('restores the absorbed cards it still has a backup for', async () => {
    const fixture = await library()
    const absorbed = [rel(fixture.root, fixture.rulePath), rel(fixture.root, fixture.conceptPath)]
    const draft = await writeDraft(fixture.root, {
      ...request({ path: 'cards/rule/merged.md' }),
      supersedes: absorbed,
    }, undefined)
    await confirmDraft(fixture.root, draft.id)
    // One backup goes missing, as a partial copy of the work directory would leave it.
    await rm(join(fixture.root, '.dsh-ip-wiki', 'backups', draft.id, 'cards', 'concept'), { recursive: true, force: true })
    const undone = await revertDraft(fixture.root, draft.id)
    expect(undone.restored).toEqual([absorbed[0]])
  })

  it('keys a draft by the set it absorbs', async () => {
    const fixture = await library()
    const rule = rel(fixture.root, fixture.rulePath)
    const concept = rel(fixture.root, fixture.conceptPath)
    const plain = await writeDraft(fixture.root, request({ path: 'cards/rule/merged.md' }), undefined)
    const one = await writeDraft(fixture.root, { ...request({ path: 'cards/rule/merged.md' }), supersedes: [rule] }, undefined)
    const two = await writeDraft(fixture.root, {
      ...request({ path: 'cards/rule/merged.md' }),
      supersedes: [concept, rule],
    }, undefined)
    expect(new Set([plain.id, one.id, two.id]).size).toBe(3)
    // The same set in another order is the same draft.
    const reordered = await writeDraft(fixture.root, {
      ...request({ path: 'cards/rule/merged.md' }),
      supersedes: [rule, concept],
    }, undefined)
    expect(reordered.id).toBe(two.id)
    // A card-only draft still passes the check with nothing to absorb.
    await expect(checkSupersedes(fixture.root, 'cards/rule/merged.md', [])).resolves.toEqual([])
  })
})

describe('proposeCardConfirmations', () => {
  const concept = 'cards/concept/concept-1.md'

  it('queues the one-line status change and leaves the card alone', async () => {
    const fixture = await library()
    const before = await readFile(fixture.conceptPath, 'utf8')
    const proposals = await proposeCardConfirmations(fixture.root, [concept], undefined)
    expect(proposals).toHaveLength(1)
    const queued = proposals[0]
    if (queued?.action !== 'queued') throw new Error('expected a queued confirmation')
    const stored = await listDrafts(fixture.root)
    expect(stored).toHaveLength(1)
    const draft = stored[0]
    if (draft === undefined) throw new Error('expected a stored draft')
    expect(draft.id).toBe(queued.id)
    expect(draft.kind).toBe('status')
    expect(draft.target).toBe(concept)
    expect(draft.title).toBe('什么是功能性特征')
    expect(draft.classification).toBe('public')
    expect(draft.generatedBy).toBe('human')
    expect(draft.sourceRef).toBe('library:card-status')
    expect(draft.supersedes).toEqual([])
    // Queueing is not writing: the card on disk still says draft.
    expect(await readFile(fixture.conceptPath, 'utf8')).toBe(before)
    const view = await viewDraft(fixture.root, draft.id)
    // The card carries no status line, so the confirmation appends one and removes
    // nothing: the difference is the single field the confirm would add.
    expect(view?.counts).toEqual({ added: 1, removed: 0 })
    expect(view?.diff.filter(line => line.kind !== 'same'))
      .toEqual([{ kind: 'added', text: 'status: "confirmed"' }])
  })

  it('flips a card that already carries a status line in place', async () => {
    const fixture = await library()
    const path = join(fixture.root, 'cards', 'concept', 'drafted.md')
    await writeFile(path, `---\ntype: "concept"\ntitle: "草稿卡"\nstatus: "draft"\n---\n\n正文。\n`)
    const proposals = await proposeCardConfirmations(fixture.root, ['cards/concept/drafted.md'], undefined)
    const queued = proposals[0]
    if (queued?.action !== 'queued') throw new Error('expected a queued confirmation')
    const view = await viewDraft(fixture.root, queued.id)
    expect(view?.counts).toEqual({ added: 1, removed: 1 })
    expect(view?.diff).toContainEqual({ kind: 'removed', text: 'status: "draft"' })
    expect(view?.diff).toContainEqual({ kind: 'added', text: 'status: "confirmed"' })
  })

  it('lands exactly the status line and reverts the card byte for byte', async () => {
    const fixture = await library()
    const before = await readFile(fixture.conceptPath, 'utf8')
    const proposals = await proposeCardConfirmations(fixture.root, [concept], undefined)
    const queued = proposals[0]
    if (queued?.action !== 'queued') throw new Error('expected a queued confirmation')
    await confirmDraft(fixture.root, queued.id)
    const landed = await readFile(fixture.conceptPath, 'utf8')
    expect(landed).toBe(before.replace('confidence: 0.62\n', 'confidence: 0.62\nstatus: "confirmed"\n'))
    expect(await readFile(join(fixture.root, '.dsh-ip-wiki', 'log.md'), 'utf8'))
      .toContain(`confirm ${queued.id} ${concept} replaced`)
    await revertDraft(fixture.root, queued.id)
    expect(await readFile(fixture.conceptPath, 'utf8')).toBe(before)
  })

  it('keys the confirmation by the card, so re-queuing a rewritten card is the same draft', async () => {
    const fixture = await library()
    const first = await proposeCardConfirmations(fixture.root, [concept], undefined)
    const rewritten = (await readFile(fixture.conceptPath, 'utf8')).replace('定义正文。', '改写过的正文。')
    await writeFile(fixture.conceptPath, rewritten)
    const second = await proposeCardConfirmations(fixture.root, [concept], undefined)
    const [before] = first
    const [after] = second
    if (before?.action !== 'queued' || after?.action !== 'queued') throw new Error('expected two queued confirmations')
    expect(after.id).toBe(before.id)
    expect(await listDrafts(fixture.root)).toHaveLength(1)
  })

  it('skips a card that is already confirmed or deprecated', async () => {
    const fixture = await library()
    const deprecated = join(fixture.root, 'cards', 'rule', 'old.md')
    await writeFile(deprecated, (await readFile(fixture.rulePath, 'utf8')).replace('status: "confirmed"', 'status: "deprecated"'))
    const proposals = await proposeCardConfirmations(fixture.root, [
      'cards/rule/rule-1.md', 'cards/rule/old.md', concept,
    ], undefined)
    expect(proposals.slice(0, 2)).toEqual([
      { action: 'skipped', path: 'cards/rule/rule-1.md', reason: 'already-confirmed' },
      { action: 'skipped', path: 'cards/rule/old.md', reason: 'deprecated' },
    ])
    expect(proposals[2]?.action).toBe('queued')
    expect(await listDrafts(fixture.root)).toHaveLength(1)
  })

  it('refuses a path outside cards/, a missing card, and a file that is not a card', async () => {
    const fixture = await library()
    await expect(proposeCardConfirmations(fixture.root, ['reports/pilot-mapping.md'], undefined))
      .rejects.toThrow(/must be a \.md file under cards\//u)
    await expect(proposeCardConfirmations(fixture.root, ['../outside.md'], undefined))
      .rejects.toThrow(/must be a \.md file under cards\//u)
    await expect(proposeCardConfirmations(fixture.root, ['cards/rule/missing.md'], undefined))
      .rejects.toThrow(/there is no card at that path/u)
    await expect(proposeCardConfirmations(fixture.root, ['cards/notes.md'], undefined))
      .rejects.toThrow(/must declare a card type/u)
  })

  it('refuses a document that declares no card type', async () => {
    const fixture = await library()
    await writeFile(join(fixture.root, 'cards', 'rule', 'plain.md'), '# 没有 frontmatter\n')
    await expect(proposeCardConfirmations(fixture.root, ['cards/rule/plain.md'], undefined))
      .rejects.toThrow(/must declare a card type/u)
  })

  it('refuses a batch larger than the ceiling', async () => {
    const fixture = await library()
    const many = Array.from({ length: 301 }, () => concept)
    await expect(proposeCardConfirmations(fixture.root, many, undefined))
      .rejects.toThrow(/at most 300 cards, got 301/u)
    await expect(proposeCardConfirmations(fixture.root, [], undefined)).resolves.toEqual([])
  })

  it('refuses to confirm a status draft whose card left the library', async () => {
    const fixture = await library()
    const proposals = await proposeCardConfirmations(fixture.root, [concept], undefined)
    const queued = proposals[0]
    if (queued?.action !== 'queued') throw new Error('expected a queued confirmation')
    await rm(fixture.conceptPath, { force: true })
    await expect(confirmDraft(fixture.root, queued.id))
      .rejects.toThrow(/needs the card on disk, and there is none/u)
  })

  it('shows a status draft whose card is gone as a whole new card', async () => {
    const fixture = await library()
    const proposals = await proposeCardConfirmations(fixture.root, [concept], undefined)
    const queued = proposals[0]
    if (queued?.action !== 'queued') throw new Error('expected a queued confirmation')
    await rm(fixture.conceptPath, { force: true })
    const view = await viewDraft(fixture.root, queued.id)
    expect(view?.existing).toBe(false)
    expect(view?.counts.removed).toBe(0)
  })
})
