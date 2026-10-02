/** Rebuilding the derived index from the cards on disk. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rebuildIndex } from '../src/host/index-file'
import { readLintReport } from '../src/host/lint'
import { makeLibrary } from './fixtures'

describe('rebuildIndex', () => {
  it('writes what the cards imply, keeps keys it does not own, and backs up the old bytes', async () => {
    const fixture = await makeLibrary({
      indexText: JSON.stringify({
        schema_version: 2,
        source_index_last_updated: '2026-01-01T00:00:00.000Z',
        total_cards: 99,
      }),
    })
    try {
      const result = await rebuildIndex(fixture.root)
      expect(result.path).toBe('index/card-index.json')
      expect(result.totalCards).toBe(2)
      expect(result.byType).toEqual({ rule: 1, concept: 1 })
      expect(result.byDomain).toEqual({ 'OA 答复': 1, '权利要求与说明书': 1 })
      expect(result.backup).toBeDefined()

      const written = JSON.parse(await readFile(join(fixture.root, 'index', 'card-index.json'), 'utf8')) as Record<string, unknown>
      expect(written['total_cards']).toBe(2)
      // Keys the plugin does not own survive the rebuild.
      expect(written['schema_version']).toBe(2)
      expect(written['source_index_last_updated']).toBe('2026-01-01T00:00:00.000Z')
      expect(written['library']).toBe(fixture.root)
      const cards = written['cards'] as Record<string, unknown>[]
      expect(cards).toHaveLength(2)
      expect(cards[0]).toMatchObject({ id: 'concept-1', type: 'concept' })
      expect(cards[1]).toMatchObject({ id: 'rule-1', type: 'rule', status: 'confirmed' })
      expect(cards[1]?.['related_concepts']).toEqual(['old-1', 'old-2'])

      const backup = await readFile(join(fixture.root, String(result.backup)), 'utf8')
      expect(JSON.parse(backup)).toMatchObject({ total_cards: 99 })
      const log = await readFile(join(fixture.root, '.dsh-ip-wiki', 'log.md'), 'utf8')
      expect(log).toContain('index rebuilt 2 cards')

      // The point of the rebuild: the gate stops reporting drift.
      const report = await readLintReport(fixture.root, 'warning')
      expect(report.findings.map(finding => finding.code)).not.toContain('index-drift')
    } finally {
      await fixture.dispose()
    }
  })

  it('writes a first index when there is none, and skips the backup', async () => {
    const fixture = await makeLibrary({ omitIndex: true })
    try {
      const result = await rebuildIndex(fixture.root)
      expect(result.backup).toBeUndefined()
      expect(result.totalCards).toBe(2)
      const written = JSON.parse(await readFile(join(fixture.root, 'index', 'card-index.json'), 'utf8')) as Record<string, unknown>
      expect(written['schema_version']).toBe(1)
    } finally {
      await fixture.dispose()
    }
  })

  it('rebuilds over an index that cannot be parsed and over one that is not an object', async () => {
    const broken = await makeLibrary({ indexText: 'this is not json' })
    try {
      expect((await rebuildIndex(broken.root)).totalCards).toBe(2)
    } finally {
      await broken.dispose()
    }
    const list = await makeLibrary({ indexText: '[1, 2, 3]' })
    try {
      await rebuildIndex(list.root)
      const written = JSON.parse(await readFile(join(list.root, 'index', 'card-index.json'), 'utf8')) as Record<string, unknown>
      expect(written['total_cards']).toBe(2)
      expect(Object.keys(written)).not.toContain('0')
    } finally {
      await list.dispose()
    }
  })
})
