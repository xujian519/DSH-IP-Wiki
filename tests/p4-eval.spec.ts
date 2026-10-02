/**
 * P4 acceptance: the confirmation queue over the real library.
 *
 * Skipped unless `DSH_IP_WIKI_EVAL=1`. The migration wrote 130 cards directly with
 * `status: draft` and no confirmation record; the user then confirmed all of them in
 * the panel. This run rebuilds that starting state on a copy — every confirmed card
 * back to `status: draft`, deprecated cards left alone — and walks the road again:
 * each card queued as a one-line status draft, confirmed through the same
 * `confirmDraft` the panel calls, and then reverted, with the library required to
 * come back byte for byte, index included.
 *
 * The measurement runs on a copy: the real library is read, never written.
 */
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { confirmDraft, listDrafts, proposeCardConfirmations, revertDraft } from '../src/host/drafts'
import { rebuildIndex } from '../src/host/index-file'
import { readLintReport } from '../src/host/lint'
import { listCardDocuments, readStatus } from '../src/host/library'

/** The library under measurement. */
const LIBRARY = '/Users/xujian/projects/LLM-wiki-card'

/** Every file outside the plugin's own work directory, path-sorted, with a digest. */
async function cardsHash(root: string, prefix = ''): Promise<string> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true })
  const parts: string[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (prefix === '' && entry.name === '.dsh-ip-wiki') continue
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) parts.push(await cardsHash(root, path))
    else parts.push(`${path}:${createHash('sha256').update(await readFile(join(root, path))).digest('hex')}`)
  }
  return parts.join('\n')
}

/** Card text with every line that sets `status` removed, so the rest can be compared. */
function withoutStatus(text: string): string {
  return text.split('\n').filter(line => !line.startsWith('status:')).join('\n')
}

/** Rewrite one card's `status` line in place. */
async function setStatus(root: string, path: string, status: string): Promise<void> {
  const text = await readFile(join(root, path), 'utf8')
  await writeFile(join(root, path), text.split('\n')
    .map(line => (line.startsWith('status:') ? `status: "${status}"` : line))
    .join('\n'))
}

describe.skipIf(process.env['DSH_IP_WIKI_EVAL'] !== '1')('P4 confirmation queue over the real library', () => {
  it('queues, confirms, and reverts every migrated card byte for byte', async () => {
    const copy = await mkdtemp(join(tmpdir(), 'dsh-ip-wiki-confirm-'))
    await cp(LIBRARY, copy, { recursive: true, filter: source => !source.includes('.dsh-ip-wiki') })
    try {
      // Put the copy back into the post-migration state: the cards the user confirmed
      // are `status: draft` again, and the index is rebuilt to agree with them.
      const seeded = await listCardDocuments(copy)
      const paths = seeded.filter(card => card.status === 'confirmed').map(card => card.path)
      for (const path of paths) await setStatus(copy, path, 'draft')
      await rebuildIndex(copy)

      const startHash = await cardsHash(copy)
      const before = new Map<string, string>()
      for (const path of paths) before.set(path, await readFile(join(copy, path), 'utf8'))
      const preview = await readLintReport(copy, 'warning')

      // Queueing is not writing: every card is still exactly what the migration left.
      const queued = await proposeCardConfirmations(copy, paths, undefined)
      const unchangedWhileQueued = (await cardsHash(copy)) === startHash
      expect(queued.filter(proposal => proposal.action === 'queued')).toHaveLength(paths.length)
      expect(queued.filter(proposal => proposal.action === 'skipped')).toHaveLength(0)
      expect(unchangedWhileQueued).toBe(true)
      expect(await listDrafts(copy)).toHaveLength(paths.length)

      const landed: string[] = []
      for (const proposal of queued) {
        if (proposal.action !== 'queued') continue
        await confirmDraft(copy, proposal.id)
        landed.push(proposal.id)
      }
      expect(landed).toHaveLength(paths.length)

      // Every card changed by the status line and by nothing else.
      for (const path of paths) {
        const text = before.get(path) ?? ''
        const after = await readFile(join(copy, path), 'utf8')
        expect(withoutStatus(after)).toBe(withoutStatus(text))
        expect(after.split('\n').filter(line => line.startsWith('status:'))).toEqual(['status: "confirmed"'])
      }
      const confirmed = await readStatus(copy)
      expect(confirmed.counts.byStatus['confirmed']).toBe(paths.length)
      expect(confirmed.counts.byStatus['draft']).toBeUndefined()
      expect(confirmed.counts.byStatus['deprecated']).toBe(seeded.length - paths.length)
      expect(confirmed.indexDrift).toBe('none')
      // Confirming a card is not a quality verdict: the gate's findings are the same.
      const after = await readLintReport(copy, 'warning')
      expect(after.counts).toEqual(preview.counts)
      // Re-queueing finds nothing left to confirm.
      const again = await proposeCardConfirmations(copy, paths, undefined)
      expect(again.filter(proposal => proposal.action === 'skipped')).toHaveLength(paths.length)

      for (const id of [...landed].reverse()) await revertDraft(copy, id)
      const restored = (await cardsHash(copy)) === startHash
      expect(restored).toBe(true)
      const reverted = await readStatus(copy)
      expect(reverted.counts.byStatus['draft']).toBe(paths.length)
      expect(reverted.indexDrift).toBe('none')

      console.log([
        '',
        '| 确认入库验收（真库副本） | 结果 |',
        '| --- | --- |',
        `| 卡片 | ${String(seeded.length)} 张；其中 ${String(paths.length)} 张放回 status: draft 复现迁移后状态 |`,
        `| 提交待确认草稿 | ${String(landed.length)} 份，队列期间卡片字节未变：${String(unchangedWhileQueued)} |`,
        '| 确认 | 每张只改 status 一行（其余行逐字相同） |',
        `| 门禁 findings | ${String(preview.findings.length)} 条，确认前后计数一致 |`,
        `| 索引 | 确认后 drift=${confirmed.indexDrift}，byStatus.confirmed=${String(paths.length)} |`,
        `| 回滚 | ${String(landed.length)} 份全部回滚，树哈希复原：${String(restored)} |`,
        '',
      ].join('\n'))
    } finally {
      await rm(copy, { recursive: true, force: true })
    }
  }, 300_000)
})
