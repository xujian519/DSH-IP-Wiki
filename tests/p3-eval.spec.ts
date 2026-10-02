/**
 * P3 acceptance: the quality gate over the real library.
 *
 * Skipped unless `DSH_IP_WIKI_EVAL=1`. It asserts what the gate must find in the
 * library as it actually stands — the migration's known defects have to be named,
 * and no card may be unusable — so the numbers in the report are reproducible.
 */
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { confirmDraft, revertDraft, writeDraft } from '../src/host/drafts'
import { duplicateGroups, readLintReport } from '../src/host/lint'
import { listCardDocuments } from '../src/host/library'

/** The library under measurement. */
const LIBRARY = '/Users/xujian/projects/LLM-cards-placeholder'

/** The real library. */
const REAL_LIBRARY = '/Users/xujian/projects/LLM-wiki-card'

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

describe.skipIf(process.env['DSH_IP_WIKI_EVAL'] !== '1')('P3 quality gate over the real library', () => {
  it('names the migration defects and finds no unusable card', async () => {
    expect(LIBRARY).not.toBe(REAL_LIBRARY)
    const report = await readLintReport(REAL_LIBRARY, 'warning')
    const byCode = new Map<string, number>()
    for (const finding of report.findings) {
      byCode.set(finding.code, (byCode.get(finding.code) ?? 0) + 1)
    }
    console.log([
      '',
      `质量门禁（真库 ${REAL_LIBRARY}）：${report.verdict === 'pass' ? '✅ 通过' : '❌ 未通过'}，失败线 ${report.failOn}，扫描 ${String(report.scanned)} 张`,
      '',
      '| 规则 | 档位 | 条数 |',
      '| --- | --- | --- |',
      ...[...byCode.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([code, count]) => {
          const tier = report.findings.find(finding => finding.code === code)?.tier ?? '?'
          return `| ${code} | ${tier} | ${count} |`
        }),
      `| **合计** | | **${String(report.findings.length)}** |`,
      '',
    ].join('\n'))
    // 全量迁移（130）→ 确认入库 → 9 组合并（139）→ Wiki 批次导入（1,137）之后：
    // 断链仍为 0；重复标题只剩源里那 4 组同题（8 条 warning），其余都是整理阶段的活。
    expect(report.scanned).toBe(1137)
    expect(report.counts.critical).toBe(0)
    expect(byCode.get('broken-link')).toBeUndefined()
    expect(byCode.get('duplicate-title')).toBe(8)
    expect(byCode.get('unclassified')).toBe(82)
    expect(byCode.get('low-confidence')).toBe(248)
    expect(byCode.get('orphan-card')).toBe(84)
    expect(byCode.get('index-drift')).toBeUndefined()
    expect(report.verdict).toBe('fail')

    // The landed state the panel produced: the nine survivors replaced 22 cards, and
    // every replacement pointer resolves to a card that is still in the library.
    const cards = await listCardDocuments(REAL_LIBRARY)
    const live = cards.filter(card => card.status !== 'deprecated')
    const deprecated = cards.filter(card => card.status === 'deprecated')
    expect(cards).toHaveLength(1137)
    expect(live).toHaveLength(1115)
    expect(deprecated).toHaveLength(22)
    expect(deprecated.every(card => cards.some(other => other.path === card.supersededBy))).toBe(true)
    // Four duplicate groups came in with the Wiki pages; each holds two cards, so the
    // gate reports one warning per card.
    expect(duplicateGroups(live)).toHaveLength(4)
    // A merged card keeps the title it was merged under, so the whole set still groups
    // each survivor with the cards it absorbed. The gate compares live cards only,
    // which is exactly why those nine groups raise no finding.
    expect(duplicateGroups(cards)).toHaveLength(13)
  }, 60_000)

  it('merges a duplicate pair on a copy, clears the finding, and reverts byte for byte', async () => {
    const copy = await mkdtemp(join(tmpdir(), 'dsh-ip-wiki-merge-'))
    await cp(REAL_LIBRARY, copy, { recursive: true, filter: source => !source.includes('.dsh-ip-wiki') })
    try {
      // The nine landed merges left the real library without a duplicate group, so this
      // run plants one and then proves the mechanism that removed the others.
      const title = '同一题目重复卡（合并验收用）'
      for (const [index, stem] of ['planted-a', 'planted-b'].entries()) {
        await writeFile(join(copy, 'cards', 'rule', `${stem}.md`), [
          '---',
          `id: "${stem}"`,
          'type: "rule"',
          `title: "${title}"`,
          'domain_l1: "专利"',
          'domain_l2: "OA 答复"',
          'concept: "合并验收"',
          'status: "confirmed"',
          '---',
          '',
          `# ${title}`,
          '',
          `第 ${String(index + 1)} 版正文。`,
        ].join('\n'))
      }
      const startHash = await cardsHash(copy)
      const before = await listCardDocuments(copy)
      // The gate compares live cards only, so the planted pair is the group to merge.
      const groups = duplicateGroups(before.filter(card => card.status !== 'deprecated'))
      const group = groups[0]
      expect(group).toBeDefined()
      if (group === undefined) throw new Error('the planted duplicate group must be found')
      const members = group.paths.map(path => before.find(card => card.path === path))
      const first = members[0]
      if (first === undefined) throw new Error('a duplicate group must have members')
      const survivor = `cards/${first.type}/merged-${String(members.length)}.md`
      const content = [
        '---',
        'id: "merged-duplicate"',
        `type: "${first.type}"`,
        `title: "${group.title}"`,
        `domain_l1: "${first.domainL1}"`,
        `domain_l2: "${first.domainL2}"`,
        `concept: "${first.concept}"`,
        'status: "confirmed"',
        'supersedes:',
        ...members.map(member => `  - "${member?.id ?? ''}"`),
        '---',
        '',
        `# ${group.title}`,
        '',
        ...members.map(member => `## 来自 ${member?.path ?? ''}\n\n${member?.body ?? ''}`),
        '',
      ].join('\n')

      const draft = await writeDraft(copy, {
        path: survivor,
        content,
        classification: 'public',
        generatedBy: 'human',
        supersedes: group.paths,
        note: '合并逐字同题的重复卡',
      }, undefined)
      expect(draft.kind).toBe('merge')

      const beforeLint = await readLintReport(copy, 'warning')
      const done = await confirmDraft(copy, draft.id)
      expect(done.deprecated).toEqual([...group.paths])
      const after = await listCardDocuments(copy)
      for (const path of group.paths) {
        const marked = after.find(card => card.path === path)
        expect(marked?.status).toBe('deprecated')
        expect(marked?.supersededBy).toBe(survivor)
      }
      const afterLint = await readLintReport(copy, 'warning')
      const duplicatesBefore = beforeLint.findings.filter(finding => finding.code === 'duplicate-title').length
      const duplicatesAfter = afterLint.findings.filter(finding => finding.code === 'duplicate-title').length
      // One finding per card in the group: the library's four two-card groups (8) plus
      // the planted pair (2).
      expect(duplicatesBefore).toBe(10)
      expect(duplicatesAfter).toBe(duplicatesBefore - group.paths.length)

      const undone = await revertDraft(copy, draft.id)
      expect(undone.restored).toEqual([...group.paths])
      expect(await cardsHash(copy)).toBe(startHash)
      const reverted = await readLintReport(copy, 'warning')
      expect(reverted.findings.filter(finding => finding.code === 'duplicate-title').length).toBe(duplicatesBefore)

      console.log([
        '',
        '| 合并验收（真库副本） | 结果 |',
        '| --- | --- |',
        `| 重复组（逐字同题） | ${String(groups.length)} 组：${groups.map(item => `「${item.title.slice(0, 18)}…」×${String(item.paths.length)}`).join('、')} |`,
        `| 合并卡 | ${survivor} |`,
        `| 弃用 | ${done.deprecated.length} 张（status: deprecated + superseded_by="${survivor}"） |`,
        `| 重复标题 finding | ${String(duplicatesBefore)} → ${String(duplicatesAfter)} |`,
        `| 回滚 | restored ${String(undone.restored.length)} 张，树哈希复原 ${String((await cardsHash(copy)) === startHash)} |`,
        `| 回滚后 finding | ${String(reverted.findings.filter(finding => finding.code === 'duplicate-title').length)} |`,
        '',
      ].join('\n'))
    } finally {
      await rm(copy, { recursive: true, force: true })
    }
  }, 120_000)
})
