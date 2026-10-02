/**
 * P2 acceptance: three real materials go through the whole loop — extract, draft,
 * review the difference, confirm, then see the card in retrieval — and every write
 * is undone byte for byte.
 *
 * Skipped unless `DSH_IP_WIKI_EVAL=1`: it needs the user's library and the material
 * files extracted beside it, so it is the measurement rather than part of the unit
 * gate. The three loops run on a copy of the library; the last case runs on the real
 * library itself and reverts inside a `finally`, so a failing assertion cannot leave
 * a card behind.
 */
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { confirmDraft, listDrafts, revertDraft, viewDraft, writeDraft } from '../src/host/drafts'
import { listCards } from '../src/host/library'
import { buildIndex, searchIndex } from '../src/host/retrieval'

/** The library under measurement. */
const LIBRARY = '/Users/xujian/projects/LLM-wiki-card'

/** Where the material texts extracted for this measurement live. */
const MATERIALS = '/tmp/ip-wiki-p2'

/** One real material and the card it should become. */
interface Material {
  readonly name: 'pdf' | 'image' | 'web'
  readonly file: string
  readonly sourceRef: string
  readonly classification: 'public' | 'client-material'
  readonly generatedBy: 'human' | 'local-model'
  readonly target: string
  readonly title: string
  /** A term the landed card must be findable by. */
  readonly keyword: string
}

/** The three materials, each with the card it should become. */
const MATERIALS_UNDER_TEST: readonly Material[] = [
  {
    name: 'pdf',
    file: 'pdf-material.txt',
    sourceRef: '/Users/xujian/Downloads/环糊精/基于傅里叶变换红外光谱技术快速测定磺丁基-β-环糊精钠的平均取代度_王晓锋.pdf',
    classification: 'public',
    generatedBy: 'local-model',
    target: 'cards/rule/pdf-磺丁基环糊精取代度测定.md',
    title: '红外光谱法快速测定磺丁基-β-环糊精钠的平均取代度',
    keyword: '磺丁基',
  },
  {
    name: 'image',
    file: 'image-material.txt',
    sourceRef: '/Users/xujian/projects/dsh-annotator/docs/samples/raster-with-arrow.png',
    classification: 'client-material',
    generatedBy: 'local-model',
    target: 'cards/case/image-附图标注-滑套.md',
    title: '附图标注：滑套未画出（sleeve 34）',
    keyword: '滑套',
  },
  {
    name: 'web',
    file: 'web-material.txt',
    sourceRef: 'https://www.cnipa.gov.cn/art/2018/11/29/art_2649_166804.html',
    classification: 'public',
    generatedBy: 'human',
    target: 'cards/rule/web-化合物发明创造性判断.md',
    title: '化合物发明创造性判断：结构接近与预料不到的效果',
    keyword: '结构接近',
  },
]

/** Compose the card a material becomes: frontmatter plus the extracted text. */
function cardFor(material: Material, materialText: string): string {
  return [
    '---',
    `id: "p2-${material.name}"`,
    `type: "${material.name === 'image' ? 'case' : 'rule'}"`,
    `title: "${material.title}"`,
    'domain_l1: "专利"',
    `domain_l2: "${material.name === 'image' ? '撰写与质检' : 'OA 答复'}"`,
    'quality: 0.6',
    'confidence: 0.7',
    'status: "draft"',
    'source:',
    `  kind: "${material.name}"`,
    `  path: "${material.sourceRef}"`,
    '---',
    '',
    `# ${material.title}`,
    '',
    '## 素材摘录',
    '',
    materialText.trim(),
    '',
  ].join('\n')
}

/** Every file under a tree, path-sorted, with a digest of its bytes. */
async function treeHash(root: string, prefix = ''): Promise<string> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true })
  const parts: string[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) parts.push(await treeHash(root, path))
    else parts.push(`${path}:${createHash('sha256').update(await readFile(join(root, path))).digest('hex')}`)
  }
  return parts.join('\n')
}

/** Drop the plugin's own work directory: the audit trail is meant to stay. */
function cardsOnly(hash: string): string {
  return hash.split('\n')
    .filter(line => line !== '' && !line.startsWith('.dsh-ip-wiki/'))
    .join('\n')
}

/** Whether the library's keyword index already holds a card with a term. */
function findable(cards: readonly { readonly title: string; readonly path: string }[], keyword: string): boolean {
  const hits = searchIndex(buildIndex(cards.map(card => ({ path: card.path, text: card.title }))), keyword, 5)
  return hits.length > 0
}

describe.skipIf(process.env['DSH_IP_WIKI_EVAL'] !== '1')('P2 material-to-card acceptance', () => {
  it('drafts, reviews, lands, and reverts three real materials', async () => {
    const copy = await mkdtemp(join(tmpdir(), 'dsh-ip-wiki-p2-'))
    await cp(LIBRARY, copy, { recursive: true, filter: source => !source.includes('.dsh-ip-wiki') })
    const startHash = cardsOnly(await treeHash(copy))
    const rows: string[] = []
    try {
      for (const material of MATERIALS_UNDER_TEST) {
        const materialText = await readFile(join(MATERIALS, material.file), 'utf8')
        const before = await listCards(copy)
        const draft = await writeDraft(copy, {
          path: material.target,
          content: cardFor(material, materialText),
          classification: material.classification,
          generatedBy: material.generatedBy,
          sourceRef: material.sourceRef,
          note: `来自${material.name}素材`,
        }, undefined)

        // 1. The draft exists, shows a difference, and is invisible to retrieval.
        const view = await viewDraft(copy, draft.id)
        const hidden = await listCards(copy)
        // 2. Confirming lands the card.
        const landed = await confirmDraft(copy, draft.id)
        const after = await listCards(copy)
        // 3. The landed card is findable and the tree is undone on revert.
        const found = findable(after, material.keyword)
        const undone = await revertDraft(copy, draft.id)
        const restoredHash = cardsOnly(await treeHash(copy))
        expect(await listDrafts(copy)).toEqual([])

        rows.push([
          `| ${material.name} | ${material.target} | +${String(view?.counts.added ?? 0)}/-${String(view?.counts.removed ?? 0)}`,
          ` | ${String(view?.existing)} | ${landed.action} | ${String(hidden.length)}→${String(after.length)}`,
          ` | ${String(found)} | ${undone.action} | ${String(restoredHash === startHash)} |`,
        ].join(''))
        expect(hidden.length).toBe(before.length)
        expect(after.length).toBe(before.length + 1)
        expect(found).toBe(true)
        expect(restoredHash).toBe(cardsOnly(startHash))
      }
      console.log([
        '',
        '| 素材 | 目标卡片 | 差异 | 已存在 | 落库 | 卡片数 | 可检索 | 回滚 | 树哈希复原 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        ...rows,
        '',
      ].join('\n'))
    } finally {
      await rm(copy, { recursive: true, force: true })
    }
  }, 120_000)

  it('leaves the real library byte for byte as it found it', async () => {
    const before = cardsOnly(await treeHash(LIBRARY))
    const startCards = (await listCards(LIBRARY)).length
    const target = 'cards/rule/eval-revert-probe.md'
    let id = ''
    try {
      const draft = await writeDraft(LIBRARY, {
        path: target,
        content: cardFor(MATERIALS_UNDER_TEST[2] as Material, await readFile(join(MATERIALS, 'web-material.txt'), 'utf8')),
        classification: 'public',
        generatedBy: 'human',
        sourceRef: 'p2-eval',
      }, undefined)
      id = draft.id
      await expect(listCards(LIBRARY)).resolves.toHaveLength(startCards)
      const landed = await confirmDraft(LIBRARY, draft.id)
      expect(landed.path).toBe(target)
      await expect(listCards(LIBRARY)).resolves.toHaveLength(startCards + 1)
    } finally {
      if (id !== '') await revertDraft(LIBRARY, id).catch(() => undefined)
      await rm(join(LIBRARY, target), { force: true })
    }
    // The audit trail is the one thing the loop is meant to leave behind; the
    // cards themselves must be exactly as they were.
    expect(cardsOnly(await treeHash(LIBRARY))).toBe(before)
  }, 120_000)

  it('records the audit trail of every decision', async () => {
    const log = await readFile(join(LIBRARY, '.dsh-ip-wiki', 'log.md'), 'utf8')
    expect(log).toContain('confirm')
    expect(log).toContain('revert')
    const entries = log.trim().split('\n').filter(line => line.includes('eval-revert-probe'))
    expect(entries.length).toBeGreaterThanOrEqual(2)
    await writeFile(join(tmpdir(), 'ip-wiki-p2-audit.txt'), log)
  })
})
