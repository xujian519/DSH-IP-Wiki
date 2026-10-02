/** Deleting a card for good, and the references it takes with it. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deleteCard } from '../src/host/delete'
import { listCards } from '../src/host/library'
import { makeLibrary } from './fixtures'

/** A card naming `concept-1` in a block list, beside a reference that stays. */
const REFERS = `---
id: "refers-1"
type: "rule"
title: "指向概念卡"
related_concepts:
  - "concept-1"
  - "rule-1"
---

# 指向概念卡
`

/** A card naming `concept-1` in an inline list. */
const REFERS_FLOW = `---
id: "refers-2"
type: "rule"
title: "流式列表指向概念卡"
related_concepts: ["concept-1"]
---

# 流式列表指向概念卡
`

describe('deleteCard', () => {
  it('removes the card, strips every reference to it, and rebuilds the index', async () => {
    const fixture = await makeLibrary()
    const refers = join(fixture.root, 'cards', 'rule', 'refers-1.md')
    const flow = join(fixture.root, 'cards', 'rule', 'refers-2.md')
    await writeFile(refers, REFERS)
    await writeFile(flow, REFERS_FLOW)

    const done = await deleteCard(fixture.root, 'cards/concept/concept-1.md')

    expect(done.title).toBe('什么是功能性特征')
    expect(done.stripped).toEqual(['cards/rule/refers-1.md'])
    // The card is gone, and the survivor keeps every byte but the removed item.
    expect(await readFile(fixture.conceptPath, 'utf8').catch(() => 'gone')).toBe('gone')
    expect(await readFile(refers, 'utf8')).toBe(REFERS.replace('  - "concept-1"\n', ''))
    // `refers-2` writes an inline list, which this dialect reads as text: it never
    // counted as a reference here, exactly as it never counted for the gate.
    expect(await readFile(flow, 'utf8')).toBe(REFERS_FLOW)
    // The index left behind describes what is left, not what was there.
    const cards = await listCards(fixture.root)
    expect(cards.map(card => card.path)).not.toContain('cards/concept/concept-1.md')
    expect(done.totalCards).toBe(cards.length)
    // The removal is the one write that cannot be undone, so it leaves the one
    // trace nothing else can reconstruct: which card, and what went with it.
    const log = await readFile(join(fixture.root, '.dsh-ip-wiki', 'log.md'), 'utf8')
    expect(log).toContain('delete cards/concept/concept-1.md 1 references stripped')
    await fixture.dispose()
  })

  it('strips a reference to the identifier the card superseded', async () => {
    const fixture = await makeLibrary()
    const replaced = join(fixture.root, 'cards', 'rule', 'replaced.md')
    const refers = join(fixture.root, 'cards', 'rule', 'refers-1.md')
    await writeFile(replaced, `---
id: "rule-9"
type: "rule"
title: "取代旧卡的新卡"
migration:
  from_id: "old-9"
---

# 取代旧卡的新卡
`)
    await writeFile(refers, `---
id: "refers-1"
type: "rule"
title: "指向旧编号"
related_concepts:
  - "old-9"
---

# 指向旧编号
`)
    const done = await deleteCard(fixture.root, 'cards/rule/replaced.md')
    expect(done.stripped).toEqual(['cards/rule/refers-1.md'])
    expect(await readFile(refers, 'utf8')).toContain('related_concepts: []')
    await fixture.dispose()
  })

  it('leaves a card nobody references alone, and deletes it', async () => {
    const fixture = await makeLibrary()
    const done = await deleteCard(fixture.root, 'cards/concept/concept-1.md')
    expect(done.stripped).toEqual([])
    // The fixture holds two cards, and the index says what is left after one goes.
    expect(done.totalCards).toBe(1)
    const log = await readFile(join(fixture.root, '.dsh-ip-wiki', 'log.md'), 'utf8')
    expect(log).toContain('delete cards/concept/concept-1.md 0 references stripped')
    await fixture.dispose()
  })

  it('refuses every path that is not a card file under cards/', async () => {
    const fixture = await makeLibrary()
    for (const path of ['reports/pilot-mapping.md', 'index/card-index.json', 'cards/notes.txt', '../outside.md', 'cards/../../../etc/hosts']) {
      await expect(deleteCard(fixture.root, path)).rejects.toThrow('must be a .md file under cards/')
    }
    // Everything the refusal touched is still there.
    expect(await readFile(fixture.reportPath, 'utf8')).toContain('试点映射报告')
    expect(await readFile(fixture.conceptPath, 'utf8')).toContain('什么是功能性特征')
    await fixture.dispose()
  })

  it('refuses a path that leaves the library, and one that names no card', async () => {
    const fixture = await makeLibrary()
    await expect(deleteCard(fixture.root, 'cards/../cards/rule/rule-1.md')).rejects.toThrow('must be a .md file under cards/')
    await expect(deleteCard(fixture.root, 'cards/rule/missing.md')).rejects.toThrow('there is no card at that path')
    // A Markdown file that declares no card kind is not a card.
    await expect(deleteCard(fixture.root, 'cards/notes.md')).rejects.toThrow('there is no card at that path')
    await fixture.dispose()
  })
})
