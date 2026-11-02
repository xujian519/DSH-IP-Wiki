// @vitest-environment jsdom
/** The library panel: what it shows, what it opens, and how it reports a failure. */
import { describe, expect, it } from 'vitest'
import { LibraryPanel } from '../src/client/IpWikiPage'
import type { HostApi } from '../src/client/host-api'
import type { CardDocument, CardSummary, LibraryStatus, LibraryTree, ReportDocument, ReviewCard, SearchResult, SearchStatus } from '../src/shared/card'
import type { CardDraft, DraftView } from '../src/host/drafts'
import type { LintReport } from '../src/host/lint'
import { defined, mount, type Mounted } from './dom'

/**
 * Expand every domain group, the way a reader who wants to see cards does.
 * @param view - the mounted panel.
 */
async function expandGroups(view: Mounted): Promise<void> {
  for (const head of view.all('button.iw-group-head')) await view.click(head)
}

/** One card as the tree lists it. */
const CARD_A: CardSummary = {
  id: 'rule-1',
  type: 'rule',
  title: '创造性判断的三步法',
  domainL1: '专利',
  domainL2: 'OA 答复',
  concept: '三步法',
  status: 'confirmed',
  confidence: 0.9,
  quality: 0.92,
  path: 'cards/rule/rule-1.md',
  relatedCount: 2,
}

/** A second card, drafted and low-confidence, so it lands in the review queue. */
const CARD_B: ReviewCard = {
  id: 'concept-1',
  type: 'concept',
  title: '什么是功能性特征',
  domainL1: '未分类',
  domainL2: '未分类',
  concept: '',
  status: 'draft',
  confidence: 0.62,
  quality: undefined,
  path: 'cards/concept/concept-1.md',
  relatedCount: 0,
}

/** The status strip a healthy library reports. */
const STATUS: LibraryStatus = {
  root: '/lib',
  exists: true,
  counts: {
    total: 2,
    byType: { rule: 1, concept: 1 },
    byDomain: { 'OA 答复': 1 },
    byStatus: { confirmed: 1, draft: 1 },
  },
  indexGeneratedAt: '2026-09-29T18:52:51+08:00',
  indexTotalCards: 2,
  indexDrift: 'none',
  reports: ['pilot-mapping.md'],
  needsReview: [CARD_B],
  problem: '',
}

/** The tree a healthy library reports. */
const TREE: LibraryTree = {
  status: STATUS,
  branches: [
    { type: 'rule', label: '规则卡', total: 1, groups: [{ key: 'rule/OA 答复', label: 'OA 答复', cards: [CARD_A] }] },
    { type: 'concept', label: '概念卡', total: 1, groups: [{ key: 'concept/未分类', label: '未分类', cards: [CARD_B] }] },
  ],
}

/** The rule card's document. */
const DOCUMENT_A: CardDocument = {
  ...CARD_A,
  body: '# 三步法\n\n**第一步**：确定最接近的现有技术。',
  lawRefs: ['专利法第 22 条第 3 款'],
  relatedConcepts: ['old-1', 'old-2'],
  wikiLinks: [],
  jurisdiction: 'CN',
  fromId: '',
  supersededBy: '',
  sourcePath: '/vault/cards/rule-1.md',
  needsReview: false,
}

/** The concept card's document, carrying none of the optional facts. */
const DOCUMENT_B: CardDocument = {
  ...CARD_B,
  body: '定义正文。',
  lawRefs: [],
  relatedConcepts: [],
  wikiLinks: [],
  jurisdiction: '',
  fromId: '',
  supersededBy: '',
  sourcePath: '',
  needsReview: true,
}

/** One report. */
const REPORT_DOC: ReportDocument = {
  name: 'pilot-mapping.md',
  text: '# 试点映射报告\n\n| # | 建议卡型 |\n| --- | --- |\n| 1 | rule |',
}

/** The retrieval status a working endpoint reports. */
const RETRIEVAL: SearchStatus = { semantic: true, reason: '', embedModel: 'bge-m3', warmed: 2, total: 2 }

/** A search answer with one hit. */
const SEARCH: SearchResult = {
  query: '三步法',
  mode: 'rerank',
  degraded: '',
  scanned: 2,
  deprecated: 0,
  duplicates: 0,
  hits: [{
    path: CARD_A.path,
    title: CARD_A.title,
    type: 'rule',
    domainL2: CARD_A.domainL2,
    concept: CARD_A.concept,
    lawRefs: ['专利法第 22 条第 3 款'],
    sourcePath: '/vault/cards/rule-1.md',
    status: 'draft',
    score: 0.87,
    matched: ['keyword', 'vector', 'rerank'],
    snippet: '三步法的第一步是确定最接近的现有技术。',
  }],
}

/** One pending draft. */
const DRAFT: CardDraft = {
  id: 'd1',
  kind: 'card',
  target: 'cards/rule/new.md',
  type: 'rule',
  title: '拟新增的规则卡',
  content: '---\ntype: "rule"\ntitle: "拟新增的规则卡"\n---\n\n# 拟新增的规则卡\n',
  supersedes: [],
  classification: 'public',
  generatedBy: 'local-model',
  policy: 'dsh-model-allowed',
  sourceRef: '/in.pdf',
  note: '来自 PDF',
  createdAt: '2026-09-29T00:00:00.000Z',
  status: 'pending',
  confirmedAt: undefined,
  revertedAt: undefined,
}

/** That draft with the difference it would make. */
const DRAFT_VIEW: DraftView = {
  draft: DRAFT,
  diff: [
    { kind: 'same', text: '---' },
    { kind: 'added', text: '# 拟新增的规则卡' },
  ],
  counts: { added: 1, removed: 0 },
  existing: false,
}

/** One status confirmation: the same card, with only its status line flipped. */
const STATUS_DRAFT: CardDraft = {
  ...DRAFT,
  id: 'd2',
  kind: 'status',
  target: CARD_A.path,
  title: CARD_A.title,
  content: '---\nstatus: "confirmed"\n---\n',
  sourceRef: 'library:card-status',
  note: '',
}

/** That status confirmation with its difference. */
const STATUS_VIEW: DraftView = {
  draft: STATUS_DRAFT,
  diff: [
    { kind: 'same', text: '---' },
    { kind: 'removed', text: 'status: "draft"' },
    { kind: 'added', text: 'status: "confirmed"' },
  ],
  counts: { added: 1, removed: 1 },
  existing: true,
}

/** The gate report a healthy library produces. */
const LINT: LintReport = {
  scanned: 2,
  findings: [
    { tier: 'warning', code: 'index-drift', message: '索引计数与磁盘不一致：索引 30 / 磁盘 2', path: '' },
    { tier: 'warning', code: 'broken-link', message: '关联卡片指向不存在的卡：old-9', path: CARD_A.path },
    { tier: 'suggestion', code: 'unclassified', message: '未归入业务域（domain_l2）', path: CARD_B.path },
  ],
  counts: { critical: 0, warning: 2, suggestion: 1 },
  failOn: 'warning',
  verdict: 'fail',
}

/** A stub host API that records what the panel asked for. */
function stubApi(options: {
  tree?: LibraryTree
  failTree?: string
  failCard?: string
  failSearch?: string
  failRetrieval?: string
  pendingSearch?: boolean
  failDraft?: string
  failDraftView?: string
  failConfirm?: string
  failConfirmAfter?: number
  pendingConfirm?: boolean
  failDiscard?: string
  failRevert?: string
  failDelete?: string
  found?: SearchResult
  retrieval?: SearchStatus
  drafts?: readonly CardDraft[]
  draftView?: DraftView
  lint?: LintReport
  failLint?: string
  failRebuild?: string
} = {}): HostApi & { readonly calls: string[] } {
  const calls: string[] = []
  const tree = options.tree ?? TREE
  return {
    calls,
    async fetchTree() {
      calls.push('tree')
      if (options.failTree !== undefined) throw new Error(options.failTree)
      return tree
    },
    async fetchStatus() {
      calls.push('status')
      return tree.status
    },
    async fetchCard(path) {
      calls.push(`card:${path}`)
      if (options.failCard !== undefined) throw new Error(options.failCard)
      return path === CARD_A.path ? DOCUMENT_A : DOCUMENT_B
    },
    async fetchReport(name) {
      calls.push(`report:${name}`)
      return { ...REPORT_DOC, name }
    },
    async fetchReports() {
      calls.push('reports')
      return [...tree.status.reports]
    },
    async fetchSearch(query, limit) {
      calls.push(`search:${query}:${String(limit)}`)
      if (options.failSearch !== undefined) throw new Error(options.failSearch)
      if (options.pendingSearch === true) return new Promise<SearchResult>(() => {})
      return options.found ?? SEARCH
    },
    async fetchSearchStatus() {
      calls.push('search-status')
      if (options.failRetrieval !== undefined) throw new Error(options.failRetrieval)
      return options.retrieval ?? RETRIEVAL
    },
    async rebuildIndex() {
      calls.push('rebuild-index')
      if (options.failRebuild !== undefined) throw new Error(options.failRebuild)
      return { totalCards: 2, byType: {}, byDomain: {}, backup: '' }
    },
    async fetchLint(failOn) {
      calls.push(`lint:${failOn}`)
      if (options.failLint !== undefined) throw new Error(options.failLint)
      return options.lint ?? LINT
    },
    async fetchDrafts() {
      calls.push('drafts')
      if (options.failDraft !== undefined) throw new Error(options.failDraft)
      return [...(options.drafts ?? [])]
    },
    async fetchDraft(id) {
      calls.push(`draft:${id}`)
      if (options.failDraftView !== undefined) throw new Error(options.failDraftView)
      // A spec that wants one exact view says so; otherwise the real host's
      // behaviour is mirrored by reading the stored draft by id, because a fixed
      // answer would hide "opened the wrong draft" bugs.
      if (options.draftView !== undefined) return options.draftView
      const stored = (options.drafts ?? []).find(candidate => candidate.id === id)
      return stored === undefined ? DRAFT_VIEW : { ...DRAFT_VIEW, draft: stored }
    },
    async confirmDraft(id) {
      calls.push(`confirm:${id}`)
      if (options.failConfirm !== undefined) throw new Error(options.failConfirm)
      // A spec that watches a batch report progress holds the first confirmation
      // open; the real host answers each one on its own.
      if (options.pendingConfirm === true) return new Promise<never>(() => {})
      const landed = calls.filter(call => call.startsWith('confirm:')).length - 1
      if (options.failConfirmAfter !== undefined && landed >= options.failConfirmAfter) {
        throw new Error(`${id} 落库失败`)
      }
      return { path: DRAFT.target, action: 'created', backup: undefined, deprecated: [...DRAFT.supersedes] }
    },
    async discardDraft(id) {
      calls.push(`discard:${id}`)
      if (options.failDiscard !== undefined) throw new Error(options.failDiscard)
    },
    async revertDraft(id) {
      calls.push(`revert:${id}`)
      if (options.failRevert !== undefined) throw new Error(options.failRevert)
      return { path: DRAFT.target, action: 'deleted', restored: [...DRAFT.supersedes] }
    },
    async deleteCard(path) {
      calls.push(`delete:${path}`)
      if (options.failDelete !== undefined) throw new Error(options.failDelete)
      return { path, title: CARD_A.title, stripped: [CARD_B.path], totalCards: 1 }
    },
  }
}

describe('LibraryPanel', () => {
  it('shows the root, the counts, the tree, and the report list', async () => {
    const view = await mount(<LibraryPanel api={stubApi()} localeId="zh-CN" />)
    await expandGroups(view)
    const text = view.text()
    expect(text).toContain('IP 知识库')
    expect(text).toContain('/lib')
    expect(text).toContain('卡片2')
    expect(text).toContain('规则卡（1）')
    expect(text).toContain('创造性判断的三步法')
    expect(text).toContain('什么是功能性特征')
    expect(text).toContain('pilot-mapping.md')
    expect(text).toContain('索引与卡片一致')
    expect(text).toContain('未确认1')
    expect(text).toContain('已确认1')
    expect(text).toContain('待确认清单（1）')
    await view.unmount()
  })

  it('opens a card and renders its facts and body', async () => {
    const api = stubApi()
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await expandGroups(view)
    const row = view.all('button.iw-row').find(button => button.textContent?.includes('创造性判断的三步法'))
    await view.click(defined(row))
    expect(api.calls).toContain(`card:${CARD_A.path}`)
    const text = view.text()
    expect(text).toContain('三步法')
    expect(text).toContain('专利法第 22 条第 3 款')
    expect(text).toContain('/vault/cards/rule-1.md')
    expect(text).toContain('第一步')
    expect(view.one('strong').textContent).toBe('第一步')
    await view.unmount()
  })

  it('omits fact rows a card leaves empty', async () => {
    const view = await mount(<LibraryPanel api={stubApi()} localeId="zh-CN" />)
    const row = view.all('button.iw-row').find(button => button.textContent?.includes('什么是功能性特征'))
    await view.click(defined(row))
    expect(view.text()).toContain('待人工确认')
    expect(view.text()).not.toContain('/vault/cards/rule-1.md')
    // No related ids and fewer than two headings: neither block is rendered.
    expect(view.all('section.iw-related')).toHaveLength(0)
    expect(view.all('details.iw-toc')).toHaveLength(0)
    await view.unmount()
  })

  it('starts with the domain groups collapsed and expands one on demand', async () => {
    const view = await mount(<LibraryPanel api={stubApi()} localeId="zh-CN" />)
    // At 1,137 cards the groups are the map, not a list to scroll end to end.
    expect(view.text()).not.toContain('创造性判断的三步法')
    await view.click(view.one('button.iw-group-head'))
    expect(view.text()).toContain('创造性判断的三步法')
    expect(view.one('button.iw-group-head').getAttribute('aria-expanded')).toBe('true')
    await view.click(view.one('button.iw-group-head'))
    expect(view.text()).not.toContain('创造性判断的三步法')
    await view.unmount()
  })

  it('opens a report and renders its table', async () => {
    const api = stubApi()
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    const row = view.all('button.iw-row').find(button => button.textContent?.includes('pilot-mapping.md'))
    await view.click(defined(row))
    expect(api.calls).toContain('report:pilot-mapping.md')
    expect(view.one('table.iw-md-table')).toBeTruthy()
    expect(view.text()).toContain('试点映射报告')
    await view.unmount()
  })

  it('opens a card from the review queue', async () => {
    const api = stubApi()
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    const queueRow = view.all('button.iw-row-flat').find(button => button.textContent?.includes('什么是功能性特征'))
    await view.click(defined(queueRow))
    expect(api.calls).toContain(`card:${CARD_B.path}`)
    expect(view.text()).toContain('定义正文')
    await view.unmount()
  })

  it('reports a failing tree read', async () => {
    const view = await mount(<LibraryPanel api={stubApi({ failTree: '库根不可读' })} localeId="zh-CN" />)
    expect(view.one('div.iw-error').textContent).toContain('库根不可读')
    await view.unmount()
  })

  it('reports a failing card read', async () => {
    const api = stubApi({ failCard: '卡片读取失败' })
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await expandGroups(view)
    const row = view.all('button.iw-row').find(button => button.textContent?.includes('创造性判断的三步法'))
    await view.click(defined(row))
    expect(view.one('div.iw-error').textContent).toContain('卡片读取失败')
    await view.unmount()
  })

  it('reports a library root that is not there', async () => {
    const missing: LibraryTree = {
      status: {
        ...STATUS,
        exists: false,
        counts: { total: 0, byType: {}, byDomain: {}, byStatus: {} },
        indexDrift: 'unreadable',
        reports: [],
        needsReview: [],
        problem: '库根不存在：/lib',
      },
      branches: [],
    }
    const view = await mount(<LibraryPanel api={stubApi({ tree: missing })} localeId="zh-CN" />)
    expect(view.text()).toContain('库根不可用')
    expect(view.text()).toContain('库根不存在：/lib')
    expect(view.text()).toContain('卡片目录为空')
    expect(view.text()).toContain('暂无整理报告')
    expect(view.text()).toContain('索引不可读')
    await view.unmount()
  })

  it('marks a drifted index and a missing index', async () => {
    const drifted = await mount(<LibraryPanel api={stubApi({
      tree: { status: { ...STATUS, indexDrift: 'count-mismatch' }, branches: [] },
    })} localeId="zh-CN" />)
    expect(drifted.text()).toContain('索引计数与卡片不符')
    expect(drifted.all('span.iw-chip-warn').length).toBeGreaterThan(0)
    await drifted.unmount()

    const indexed = await mount(<LibraryPanel api={stubApi({
      tree: { status: { ...STATUS, indexGeneratedAt: undefined, indexTotalCards: undefined, indexDrift: 'missing' }, branches: [] },
    })} localeId="zh-CN" />)
    expect(indexed.text()).toContain('无索引')
    await indexed.unmount()
  })

  it('shows the busy chip and the empty tree while the first read is in flight', async () => {
    const pending: HostApi = {
      ...stubApi(),
      fetchTree: () => new Promise<LibraryTree>(() => {}),
    }
    const view = await mount(<LibraryPanel api={pending} localeId="zh-CN" />)
    expect(view.text()).toContain('正在读取…')
    expect(view.text()).toContain('卡片目录为空')
    expect(view.text()).toContain('暂无整理报告')
    await view.unmount()
  })

  it('renders a deprecated card and one that carries no confidence', async () => {
    const deprecated: CardSummary = { ...CARD_A, status: 'deprecated', confidence: undefined, quality: undefined, concept: '' }
    const tree: LibraryTree = {
      status: {
        ...STATUS,
        counts: { total: 1, byType: { rule: 1 }, byDomain: {}, byStatus: { deprecated: 1 } },
        needsReview: [],
      },
      branches: [{ type: 'rule', label: '规则卡', total: 1, groups: [{ key: 'rule/x', label: 'x', cards: [deprecated] }] }],
    }
    const api: HostApi = {
      ...stubApi({ tree }),
      fetchCard: async () => ({
        ...deprecated,
        body: '正文',
        lawRefs: [],
        relatedConcepts: [],
        wikiLinks: [],
        jurisdiction: '',
        fromId: '',
        supersededBy: 'cards/rule/newer.md',
        sourcePath: '',
        needsReview: false,
      }),
    }
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await expandGroups(view)
    await view.click(defined(view.all('button.iw-row').find(button => button.textContent?.includes('创造性判断的三步法'))))
    expect(view.text()).toContain('已废弃')
    expect(view.text()).toContain('已被取代')
    expect(view.text()).toContain('cards/rule/newer.md')
    expect(view.text()).not.toContain('置信度')
    await view.unmount()
  })

  it('reports a failing report read', async () => {
    const failing: HostApi = {
      ...stubApi(),
      fetchReport: async () => { throw new Error('报告读取失败') },
    }
    const view = await mount(<LibraryPanel api={failing} localeId="zh-CN" />)
    const row = view.all('button.iw-row').find(button => button.textContent?.includes('pilot-mapping.md'))
    await view.click(defined(row))
    expect(view.text()).toContain('报告读取失败')
    await view.unmount()
  })

  it('renders a failure that is not an Error', async () => {
    const failing: HostApi = {
      ...stubApi(),
      fetchTree: async () => { throw '字符串失败' },
    }
    const view = await mount(<LibraryPanel api={failing} localeId="zh-CN" />)
    expect(view.text()).toContain('字符串失败')
    await view.unmount()
  })

  it('counts a card kind the panel does not label by its own key', async () => {
    const view = await mount(<LibraryPanel api={stubApi({
      tree: { status: { ...STATUS, counts: { ...STATUS.counts, byType: { rule: 1, note: 2 } } }, branches: [] },
    })} localeId="zh-CN" />)
    expect(view.text()).toContain('note2')
    await view.unmount()
  })

  it('re-reads the tree when the reader asks for a refresh', async () => {
    const api = stubApi()
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    expect(api.calls.filter(call => call === 'tree')).toHaveLength(1)
    await view.click(view.one('button.iw-btn'))
    expect(api.calls.filter(call => call === 'tree')).toHaveLength(2)
    await view.unmount()
  })

  it('renders English copy for an English locale', async () => {
    const view = await mount(<LibraryPanel api={stubApi()} localeId="en-US" />)
    expect(view.text()).toContain('IP Knowledge Wiki')
    expect(view.text()).toContain('Card tree')
    await view.unmount()
  })

  it('searches from the panel and shows hits with excerpt and provenance', async () => {
    const api = stubApi()
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await view.type(view.input('input.iw-input'), '三步法')
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '检索')))
    expect(api.calls).toContain('search:三步法:10')
    const text = view.text()
    expect(text).toContain('检索结果（1）')
    expect(text).toContain('语义 + 精排')
    expect(text).toContain('创造性判断的三步法')
    expect(text).toContain('三步法的第一步是确定最接近的现有技术。')
    expect(text).toContain('专利法第 22 条第 3 款')
    // The results replace the tree; the only place the word "tree" still shows is
    // the button that goes back to it.
    expect(view.all('div.iw-group')).toHaveLength(0)
    await view.unmount()
  })

  it('runs the search when the reader presses Enter', async () => {
    const api = stubApi()
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    const input = view.input('input.iw-input')
    await view.type(input, '三步法')
    await view.press(input, 'Enter')
    expect(api.calls).toContain('search:三步法:10')
    await view.unmount()
  })

  it('opens a card from the results and marks the open hit', async () => {
    const api = stubApi()
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await view.type(view.input('input.iw-input'), '三步法')
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '检索')))
    await view.click(defined(view.all('button.iw-row').find(button => button.textContent?.includes('创造性判断的三步法'))))
    expect(api.calls).toContain(`card:${CARD_A.path}`)
    expect(view.text()).toContain('/vault/cards/rule-1.md')
    expect(view.all('button.iw-row-selected').length).toBeGreaterThan(0)
    await view.unmount()
  })

  it('returns to the card tree when the search is cleared', async () => {
    const api = stubApi()
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await view.type(view.input('input.iw-input'), '三步法')
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '检索')))
    expect(view.all('div.iw-group')).toHaveLength(0)
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '返回卡片树')))
    expect(view.all('div.iw-group').length).toBeGreaterThan(0)
    await view.unmount()
  })

  it('clears the results when an empty query is submitted', async () => {
    const api = stubApi()
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '检索')))
    expect(api.calls.filter(call => call.startsWith('search:'))).toEqual([])
    expect(view.text()).toContain('卡片树')
    await view.unmount()
  })

  it('says when nothing was found and shows why a stage was skipped', async () => {
    const view = await mount(<LibraryPanel api={stubApi({
      found: { query: 'x', mode: 'keyword', degraded: '未配置 embedding', scanned: 2, deprecated: 0, duplicates: 0, hits: [] },
    })} localeId="zh-CN" />)
    await view.type(view.input('input.iw-input'), 'x')
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '检索')))
    expect(view.text()).toContain('没有命中')
    expect(view.text()).toContain('未配置 embedding')
    expect(view.text()).toContain('关键词')
    await view.unmount()
  })

  it('reports a failing search', async () => {
    const view = await mount(<LibraryPanel api={stubApi({ failSearch: '检索挂了' })} localeId="zh-CN" />)
    await view.type(view.input('input.iw-input'), '三步法')
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '检索')))
    expect(view.text()).toContain('检索挂了')
    await view.unmount()
  })

  it('renders a hit that carries no provenance at all', async () => {
    const bare = {
      ...SEARCH,
      hits: [{ ...defined(SEARCH.hits[0]), lawRefs: [], sourcePath: '' }],
    }
    const view = await mount(<LibraryPanel api={stubApi({ found: bare })} localeId="zh-CN" />)
    await view.type(view.input('input.iw-input'), '三步法')
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '检索')))
    expect(view.text()).toContain('创造性判断的三步法')
    expect(view.text()).not.toContain('出处')
    await view.unmount()
  })

  it('counts the deprecated cards it sank below the live hits', async () => {
    const view = await mount(<LibraryPanel api={stubApi({ found: { ...SEARCH, scanned: 139, deprecated: 22 } })} localeId="zh-CN" />)
    await view.type(view.input('input.iw-input'), '三步法')
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '检索')))
    expect(view.text()).toContain('扫描卡片 139')
    expect(view.text()).toContain('已废弃 22')
    await view.unmount()
  })

  it('counts the repeats it sank below the distinct hits', async () => {
    const view = await mount(<LibraryPanel api={stubApi({ found: { ...SEARCH, duplicates: 3 } })} localeId="zh-CN" />)
    await view.type(view.input('input.iw-input'), '三步法')
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '检索')))
    expect(view.text()).toContain('近似重复 3')
    await view.unmount()
  })

  it('shows the searching indicator while a search is in flight', async () => {
    const view = await mount(<LibraryPanel api={stubApi({ pendingSearch: true })} localeId="zh-CN" />)
    await view.type(view.input('input.iw-input'), '三步法')
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '检索')))
    expect(view.text()).toContain('检索中…')
    await view.unmount()
  })

  it('reports a failing retrieval-status read', async () => {
    const view = await mount(<LibraryPanel api={stubApi({ failRetrieval: '状态读取失败' })} localeId="zh-CN" />)
    expect(view.text()).toContain('状态读取失败')
    await view.unmount()
  })

  it('shows the quality gate, folds its tiers, and lists a tier on demand', async () => {
    const api = stubApi()
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    expect(api.calls).toContain('lint:warning')
    expect(view.text()).toContain('质量门禁')
    await view.click(defined(view.all('button.iw-row').find(button => button.textContent?.includes('未通过'))))
    const text = view.text()
    expect(text).toContain('broken-link')
    expect(text).toContain('关联卡片指向不存在的卡：old-9')
    expect(text).toContain('库级')
    expect(view.all('div.iw-tier-warning')).toHaveLength(2)
    // 422 findings in the real library are mostly the least serious tier, so it
    // stays folded until it is asked for.
    expect(view.all('div.iw-tier-suggestion')).toHaveLength(0)
    const suggestion = defined(view.all('button.iw-tier-head').find(head => head.getAttribute('data-tier') === 'suggestion'))
    expect(suggestion.getAttribute('aria-expanded')).toBe('false')
    await view.click(suggestion)
    expect(view.all('div.iw-tier-suggestion')).toHaveLength(1)
    expect(suggestion.getAttribute('aria-expanded')).toBe('true')
    await view.click(suggestion)
    expect(view.all('div.iw-tier-suggestion')).toHaveLength(0)
    expect(view.all('span.iw-chip-error').length).toBeGreaterThan(0)
    await view.unmount()
  })

  it('rebuilds the index from the gate view and re-reads it', async () => {
    const api = stubApi()
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await view.click(defined(view.all('button.iw-row').find(button => button.textContent?.includes('未通过'))))
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '重建索引')))
    expect(api.calls).toContain('rebuild-index')
    expect(api.calls.filter(call => call === 'lint:warning')).toHaveLength(2)
    expect(api.calls.filter(call => call === 'tree')).toHaveLength(2)
    await view.unmount()
  })

  it('reports a failing rebuild', async () => {
    const api = stubApi({ failRebuild: '索引重建失败' })
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await view.click(defined(view.all('button.iw-row').find(button => button.textContent?.includes('未通过'))))
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '重建索引')))
    expect(view.text()).toContain('索引重建失败')
    await view.unmount()
  })

  it('renders a gate that passed and one that found nothing', async () => {
    const clean: LintReport = {
      scanned: 2,
      findings: [],
      counts: { critical: 0, warning: 0, suggestion: 0 },
      failOn: 'warning',
      verdict: 'pass',
    }
    const view = await mount(<LibraryPanel api={stubApi({ lint: clean })} localeId="zh-CN" />)
    await view.click(defined(view.all('button.iw-row').find(button => button.textContent?.includes('通过'))))
    expect(view.text()).toContain('没有发现任何问题')
    expect(view.all('span.iw-chip-ok').length).toBeGreaterThan(0)
    await view.unmount()
  })

  it('reports a failing gate read', async () => {
    const view = await mount(<LibraryPanel api={stubApi({ failLint: '门禁读取失败' })} localeId="zh-CN" />)
    expect(view.text()).toContain('门禁读取失败')
    expect(view.text()).toContain('正在读取…')
    await view.unmount()
  })

  it('lists the pending drafts and shows one with its difference', async () => {
    const api = stubApi({ drafts: [DRAFT] })
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    expect(view.text()).toContain('待确认草稿（1）')
    await view.click(defined(view.all('button.iw-row').find(button => button.textContent?.includes('拟新增的规则卡'))))
    expect(api.calls).toContain('draft:d1')
    const text = view.text()
    expect(text).toContain('目标')
    expect(text).toContain('cards/rule/new.md')
    expect(text).toContain('新建卡片')
    expect(text).toContain('dsh-model-allowed')
    expect(text).toContain('public / local-model')
    expect(text).toContain('/in.pdf')
    expect(text).toContain('来自 PDF')
    expect(view.all('div.iw-diff-added')).toHaveLength(1)
    expect(view.all('div.iw-diff-same')).toHaveLength(1)
    await view.unmount()
  })

  it('warns on a draft only local models may see', async () => {
    const view = await mount(<LibraryPanel api={stubApi({
      drafts: [{ ...DRAFT, classification: 'client-material', policy: 'local-only' }],
    })} localeId="zh-CN" />)
    await view.click(defined(view.all('button.iw-row')[0]))
    expect(view.text()).toContain('仅本地模型')
    expect(view.all('span.iw-chip-warn').length).toBeGreaterThan(0)
    await view.unmount()
  })

  it('reads a draft that replaces a card, carries no note, and removes lines', async () => {
    const bare: DraftView = {
      draft: { ...DRAFT, title: '', note: '', sourceRef: '' },
      diff: [
        { kind: 'same', text: '---' },
        { kind: 'removed', text: '旧的一行' },
        { kind: 'added', text: '新的一行' },
      ],
      counts: { added: 1, removed: 1 },
      existing: true,
    }
    const view = await mount(<LibraryPanel api={stubApi({ drafts: [{ ...DRAFT, title: '' }], draftView: bare })} localeId="zh-CN" />)
    expect(view.text()).toContain('cards/rule/new.md')
    await view.click(defined(view.all('button.iw-row')[0]))
    const text = view.text()
    expect(text).toContain('将替换现有卡片')
    expect(view.all('div.iw-diff-removed')).toHaveLength(1)
    expect(text).not.toContain('来自 PDF')
    expect(text).not.toContain('/in.pdf')
    await view.unmount()
  })

  it('reports each failing draft action', async () => {
    const read = await mount(<LibraryPanel api={stubApi({ drafts: [DRAFT], failDraftView: '草稿读不回来' })} localeId="zh-CN" />)
    await read.click(defined(read.all('button.iw-row')[0]))
    expect(read.text()).toContain('草稿读不回来')
    await read.unmount()

    const confirmed = await mount(<LibraryPanel api={stubApi({ drafts: [DRAFT], failConfirm: '落库失败' })} localeId="zh-CN" />)
    await confirmed.click(defined(confirmed.all('button.iw-row')[0]))
    await confirmed.click(defined(confirmed.all('button.iw-btn').find(button => button.textContent === '确认落库')))
    expect(confirmed.text()).toContain('落库失败')
    await confirmed.unmount()

    const discarded = await mount(<LibraryPanel api={stubApi({ drafts: [DRAFT], failDiscard: '作废失败' })} localeId="zh-CN" />)
    await discarded.click(defined(discarded.all('button.iw-row')[0]))
    await discarded.click(defined(discarded.all('button.iw-btn').find(button => button.textContent === '作废')))
    expect(discarded.text()).toContain('作废失败')
    await discarded.unmount()

    const reverted = await mount(<LibraryPanel api={stubApi({ drafts: [DRAFT], failRevert: '回滚失败' })} localeId="zh-CN" />)
    await reverted.click(defined(reverted.all('button.iw-row')[0]))
    await reverted.click(defined(reverted.all('button.iw-btn').find(button => button.textContent === '确认落库')))
    await reverted.click(defined(reverted.all('button.iw-btn').find(button => button.textContent === '回滚')))
    expect(reverted.text()).toContain('回滚失败')
    await reverted.unmount()
  })

  it('shows a merge, the cards it will absorb, and opens one of them', async () => {
    const merge: CardDraft = { ...DRAFT, kind: 'merge', supersedes: [CARD_A.path, CARD_B.path] }
    const api = stubApi({ drafts: [merge], draftView: { ...DRAFT_VIEW, draft: merge } })
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await view.click(defined(view.all('button.iw-row').find(button => button.textContent?.includes('拟新增的规则卡'))))
    const text = view.text()
    expect(text).toContain('合并')
    expect(text).toContain('将弃用（2）')
    expect(text).toContain(CARD_A.path)
    expect(text).toContain(CARD_B.path)
    expect(text).toContain('superseded_by')
    // The absorbed card is one click away, so the reader can compare before deciding.
    await view.click(defined(view.all('button.iw-row').find(button => button.textContent?.includes(CARD_B.path))))
    expect(api.calls).toContain(`card:${CARD_B.path}`)
    await view.unmount()
  })

  it('confirms a draft and offers to revert the card it landed', async () => {
    const api = stubApi({ drafts: [DRAFT] })
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await view.click(defined(view.all('button.iw-row')[0]))
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '确认落库')))
    expect(api.calls).toContain('confirm:d1')
    expect(view.text()).toContain('已落库')
    expect(view.text()).toContain('cards/rule/new.md')
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '回滚')))
    expect(api.calls).toContain('revert:d1')
    expect(view.text()).not.toContain('已落库')
    await view.unmount()
  })

  it('discards a draft without landing anything', async () => {
    const api = stubApi({ drafts: [DRAFT] })
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await view.click(defined(view.all('button.iw-row')[0]))
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '作废')))
    expect(api.calls).toContain('discard:d1')
    expect(view.text()).not.toContain('已落库')
    await view.unmount()
  })

  it('renders a status confirmation and the one line it would change', async () => {
    const api = stubApi({ drafts: [STATUS_DRAFT], draftView: STATUS_VIEW })
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    const row = defined(view.all('button.iw-row-flat').find(button => button.textContent?.includes(CARD_A.path)))
    expect(row.textContent).toContain('状态确认')
    await view.click(row)
    expect(api.calls).toContain('draft:d2')
    const text = view.text()
    expect(text).toContain('状态确认')
    expect(text).toContain('library:card-status')
    expect(text).toContain('将替换现有卡片')
    expect(view.all('div.iw-diff-added')).toHaveLength(1)
    expect(view.all('div.iw-diff-removed')).toHaveLength(1)
    await view.unmount()
  })

  it('confirms every pending draft in one batch and reverts the whole batch', async () => {
    const api = stubApi({ drafts: [DRAFT, STATUS_DRAFT] })
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent?.startsWith('全部确认'))))
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '继续')))
    expect(api.calls).toContain('confirm:d1')
    expect(api.calls).toContain('confirm:d2')
    expect(view.text()).toContain('本批已落库')
    expect(view.text()).toContain('2 张卡')
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '回滚')))
    expect(api.calls).toContain('revert:d1')
    expect(api.calls).toContain('revert:d2')
    // Newest first, so the library unwinds in the reverse of the order it landed.
    expect(api.calls.indexOf('revert:d2')).toBeLessThan(api.calls.indexOf('revert:d1'))
    expect(view.text()).not.toContain('本批已落库')
    await view.unmount()
  })

  it('keeps the drafts that landed when a batch stops half way', async () => {
    const api = stubApi({ drafts: [DRAFT, STATUS_DRAFT], failConfirmAfter: 1 })
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent?.startsWith('全部确认'))))
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '继续')))
    expect(api.calls).toContain('confirm:d1')
    expect(api.calls).toContain('confirm:d2')
    const text = view.text()
    expect(text).toContain('d2 落库失败')
    expect(text).toContain('本批中断，已落库 1 张卡')
    expect(text).toContain('1 张卡')
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '回滚')))
    expect(api.calls).toContain('revert:d1')
    expect(api.calls).not.toContain('revert:d2')
    await view.unmount()

    // A batch that fails on its first draft lands nothing, so there is nothing to
    // offer a rollback for.
    const none = stubApi({ drafts: [DRAFT, STATUS_DRAFT], failConfirmAfter: 0 })
    const nothing = await mount(<LibraryPanel api={none} localeId="zh-CN" />)
    await nothing.click(defined(nothing.all('button.iw-btn').find(button => button.textContent?.startsWith('全部确认'))))
    await nothing.click(defined(nothing.all('button.iw-btn').find(button => button.textContent === '继续')))
    expect(nothing.text()).toContain('本批中断，已落库 0 张卡')
    expect(nothing.text()).not.toContain('可回滚')
    await nothing.unmount()
  })

  it('says when there is nothing to confirm, and reports a failing draft read', async () => {
    const empty = await mount(<LibraryPanel api={stubApi()} localeId="zh-CN" />)
    expect(empty.text()).toContain('没有待确认的草稿')
    await empty.unmount()
    const failing = await mount(<LibraryPanel api={stubApi({ failDraft: '草稿区不可读' })} localeId="zh-CN" />)
    expect(failing.text()).toContain('草稿区不可读')
    await failing.unmount()
  })

  it('shows how much of the corpus the semantic stage has seen', async () => {
    const warming = await mount(<LibraryPanel api={stubApi({
      retrieval: { semantic: true, reason: '', embedModel: 'bge-m3', warmed: 12, total: 40 },
    })} localeId="zh-CN" />)
    expect(warming.text()).toContain('预热12/40')
    await warming.unmount()
    // A fully warm corpus says nothing about warming: there is no progress left to report.
    const warm = await mount(<LibraryPanel api={stubApi()} localeId="zh-CN" />)
    expect(warm.text()).not.toContain('预热')
    await warm.unmount()
  })

  it('warns when only keywords are available and reads the mode chip otherwise', async () => {
    const keywordOnly = await mount(<LibraryPanel api={stubApi({
      retrieval: { semantic: false, reason: '未读到本地 API key', embedModel: '', warmed: 0, total: 0 },
    })} localeId="zh-CN" />)
    expect(keywordOnly.text()).toContain('仅关键词')
    expect(keywordOnly.all('span.iw-chip-warn').length).toBeGreaterThan(0)
    await keywordOnly.unmount()
    const semantic = await mount(<LibraryPanel api={stubApi()} localeId="zh-CN" />)
    expect(semantic.text()).toContain('语义 + 精排')
    await semantic.unmount()
  })

  it('shows the empty-state hint before anything is selected', async () => {
    const view = await mount(<LibraryPanel api={stubApi()} localeId="zh-CN" />)
    expect(view.text()).toContain('从左侧选择一张卡片或一份整理报告')
    await view.unmount()
  })

  it('asks before a batch writes anything, then reports how far it got', async () => {
    const api = stubApi({ drafts: [DRAFT, STATUS_DRAFT], pendingConfirm: true })
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    const ask = defined(view.all('button.iw-btn').find(button => button.textContent?.startsWith('全部确认')))
    await view.click(ask)
    // The count rides on the button, and the first click only asks.
    expect(view.text()).toContain('全部确认（2）')
    expect(view.text()).toContain('可整批回滚')
    expect(api.calls).not.toContain('confirm:d1')
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '继续')))
    expect(api.calls).toContain('confirm:d1')
    expect(view.text()).toContain('正在落库0/2')
    await view.unmount()
  })

  it('drops the batch question without writing when it is cancelled', async () => {
    const api = stubApi({ drafts: [DRAFT, STATUS_DRAFT] })
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent?.startsWith('全部确认'))))
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '取消')))
    expect(view.text()).not.toContain('可整批回滚')
    expect(api.calls).not.toContain('confirm:d1')
    await view.unmount()
  })

  it('reads the library again from the failure notice', async () => {
    const api = stubApi({ failTree: '库根不可读' })
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    expect(view.one('div.iw-error').textContent).toContain('库根不可读')
    const before = api.calls.filter(call => call === 'tree').length
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '重试')))
    expect(api.calls.filter(call => call === 'tree').length).toBe(before + 1)
    await view.unmount()
  })

  it('dresses a destructive action differently from a read', async () => {
    const api = stubApi({ drafts: [DRAFT] })
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await view.click(defined(view.all('button.iw-row')[0]))
    const buttons = view.all('button.iw-btn')
    const textOf = (label: string): HTMLElement =>
      defined(buttons.find(button => button.textContent === label))
    // 作废 drops a draft and cannot be reverted, 刷新 only reads, and 确认落库
    // writes what can be reverted: the class is the observable half of that
    // distinction, which a label alone does not carry.
    expect(textOf('作废').className).toContain('iw-btn-danger')
    expect(textOf('确认落库').className).toContain('iw-btn-primary')
    expect(textOf('刷新').className).toContain('iw-btn-quiet')
    await view.unmount()
  })

  it('asks before deleting a card, then reports what the deletion cleared', async () => {
    const api = stubApi()
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await expandGroups(view)
    await view.click(defined(view.all('button.iw-row').find(button => button.textContent?.includes('创造性判断的三步法'))))
    const titleRow = view.one('.iw-read .iw-read-actions')
    expect(titleRow.querySelector('h2.iw-read-title')?.textContent).toBe(CARD_A.title)
    const ask = titleRow.querySelector('button')
    expect(ask?.textContent).toBe('删除')
    expect(ask?.className).toContain('iw-btn-danger')
    await view.click(defined(ask))
    const confirm = view.one('.iw-read .iw-confirm')
    expect(confirm.className).toContain('iw-confirm-stack')
    expect(confirm.querySelector('.iw-confirm-ask')?.textContent).toContain('此操作不可回滚')
    expect(confirm.querySelectorAll('.iw-confirm-actions button')).toHaveLength(2)
    expect(confirm.querySelector('.iw-confirm-actions .iw-btn-danger')?.textContent).toBe('永久删除')
    expect(api.calls).not.toContain(`delete:${CARD_A.path}`)
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '永久删除')))
    expect(api.calls).toContain(`delete:${CARD_A.path}`)
    const text = view.text()
    expect(text).toContain('已删除')
    expect(text).toContain(CARD_A.title)
    expect(text).toContain('1 处关联已清掉')
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '知道了')))
    expect(view.text()).not.toContain('已删除')
    await view.unmount()
  })

  it('drops the delete question on cancel, and reports a refused deletion', async () => {
    const view = await mount(<LibraryPanel api={stubApi()} localeId="zh-CN" />)
    await expandGroups(view)
    await view.click(defined(view.all('button.iw-row').find(button => button.textContent?.includes('创造性判断的三步法'))))
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '删除')))
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '取消')))
    expect(view.text()).not.toContain('此操作不可回滚')
    await view.unmount()

    const refused = stubApi({ failDelete: '没有这张卡' })
    const other = await mount(<LibraryPanel api={refused} localeId="zh-CN" />)
    await expandGroups(other)
    await other.click(defined(other.all('button.iw-row').find(button => button.textContent?.includes('创造性判断的三步法'))))
    await other.click(defined(other.all('button.iw-btn').find(button => button.textContent === '删除')))
    await other.click(defined(other.all('button.iw-btn').find(button => button.textContent === '永久删除')))
    expect(other.one('div.iw-error').textContent).toContain('没有这张卡')
    await other.unmount()
  })

  it('filters the tree by title without asking the library', async () => {
    const api = stubApi()
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    // The grouped tree is replaced by the matches, so its branch headings go too.
    expect(view.text()).toContain('规则卡（1）')
    await view.type(view.input('input.iw-filter-input'), '创造性')
    expect(view.text()).not.toContain('规则卡（1）')
    expect(view.all('button.iw-row').some(row => row.textContent?.includes('创造性判断的三步法'))).toBe(true)
    expect(api.calls.filter(call => call.startsWith('search:'))).toHaveLength(0)
    await view.type(view.input('input.iw-filter-input'), '没有这张卡')
    expect(view.text()).toContain('没有标题匹配的卡片')
    await view.type(view.input('input.iw-filter-input'), '')
    expect(view.text()).toContain('规则卡（1）')
    await view.unmount()
  })

  it('shows or collapses the whole tree on Shift+X', async () => {
    const view = await mount(<LibraryPanel api={stubApi()} localeId="zh-CN" />)
    expect(view.text()).not.toContain('创造性判断的三步法')
    // A bare x is a keystroke like any other, not a tree command.
    await view.press(document.body, 'x')
    expect(view.text()).not.toContain('创造性判断的三步法')
    await view.press(document.body, 'X', { shiftKey: true })
    expect(view.text()).toContain('创造性判断的三步法')
    await view.press(document.body, 'X', { shiftKey: true })
    expect(view.text()).not.toContain('创造性判断的三步法')
    await view.unmount()
  })

  it('opens the related card a body links to, and leaves an unknown link plain', async () => {
    const base = stubApi()
    const api: HostApi = {
      ...base,
      // The stand-in records the read the way the shared stub does, so a spec can
      // tell "opened the linked card" from "redrew the same one".
      fetchCard: async (path) => {
        base.calls.push(`card:${path}`)
        return path === CARD_A.path
          ? { ...DOCUMENT_A, relatedConcepts: [], body: '# 三步法\n\n见 [[什么是功能性特征]] 与 [[不存在的页]]。' }
          : DOCUMENT_B
      },
    }
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await expandGroups(view)
    await view.click(defined(view.all('button.iw-row').find(button => button.textContent?.includes('创造性判断的三步法'))))
    // One link resolves by page name and becomes a control; the other stays text.
    expect(view.all('button.iw-wikilink-open')).toHaveLength(1)
    expect(view.all('span.iw-wikilink')).toHaveLength(1)
    await view.click(defined(view.all('button.iw-wikilink-open')[0]))
    expect(base.calls).toContain(`card:${CARD_B.path}`)
    await view.unmount()
  })

  it('makes a related card the library holds clickable', async () => {
    const base = stubApi()
    const api: HostApi = {
      ...base,
      fetchCard: async (path) => {
        base.calls.push(`card:${path}`)
        return path === CARD_A.path ? { ...DOCUMENT_A, relatedConcepts: ['concept-1'], body: '正文。' } : DOCUMENT_B
      },
    }
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await expandGroups(view)
    await view.click(defined(view.all('button.iw-row').find(button => button.textContent?.includes('创造性判断的三步法'))))
    expect(view.text()).toContain('相关卡片 · 1')
    expect(view.text()).not.toContain('不在库内')
    // The id axis of the resolver: `related_concepts` holds ids, not page names.
    await view.click(defined(view.all('button.iw-wikilink-open')[0]))
    expect(base.calls).toContain(`card:${CARD_B.path}`)
    await view.unmount()
  })

  it('opens a card straight from the filtered list', async () => {
    const api = stubApi()
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await view.type(view.input('input.iw-filter-input'), '创造性')
    const match = defined(view.all('button.iw-row').find(row => row.textContent?.includes('创造性判断的三步法')))
    await view.click(match)
    expect(api.calls).toContain(`card:${CARD_A.path}`)
    await view.unmount()
  })

  it('names the path when a deleted card carried no title', async () => {
    const base = stubApi()
    const api: HostApi = {
      ...base,
      deleteCard: async (path) => {
        base.calls.push(`delete:${path}`)
        return { path, title: '', stripped: [], totalCards: 1 }
      },
    }
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await expandGroups(view)
    await view.click(defined(view.all('button.iw-row').find(button => button.textContent?.includes('创造性判断的三步法'))))
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '删除')))
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '永久删除')))
    expect(view.text()).toContain(CARD_A.path)
    expect(view.text()).toContain('0 处关联已清掉')
    await view.unmount()
  })

  it('expands nothing when the tree has not arrived yet', async () => {
    const api: HostApi = { ...stubApi(), fetchTree: async () => new Promise<LibraryTree>(() => {}) }
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await view.press(document.body, 'X', { shiftKey: true })
    expect(view.text()).toContain('正在读取…')
    await view.unmount()
  })

  it('lists the headings it can reach and omits the one that repeats the title', async () => {
    // jsdom has no layout, so the scroll a contents entry performs needs a stand-in.
    Element.prototype.scrollIntoView = () => {}
    const api: HostApi = {
      ...stubApi(),
      fetchCard: async () => ({
        ...DOCUMENT_A,
        relatedConcepts: ['missing-1'],
        body: '# 创造性判断的三步法\n\n## 第一节\n\n正文一。\n\n## 第二节\n\n正文二。',
      }),
    }
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await expandGroups(view)
    await view.click(defined(view.all('button.iw-row').find(button => button.textContent?.includes('创造性判断的三步法'))))
    expect(view.text()).toContain('本篇目录')
    const toc = view.one('details.iw-toc')
    expect(toc.hasAttribute('open')).toBe(true)
    expect(view.all('button.iw-toc-item')).toHaveLength(2)
    // The title heading is neither rendered a second time nor listed.
    expect(view.all('h3.iw-md-h1')).toHaveLength(0)
    expect(view.all('h4.iw-md-h2')).toHaveLength(2)
    await view.click(defined(view.all('button.iw-toc-item')[1]))
    // A related id the library does not hold is text plus the unresolved note,
    // never a control.
    const unresolved = view.one('span.iw-related-unresolved')
    expect(unresolved.textContent).toContain('missing-1')
    expect(unresolved.textContent).toContain('不在库内')
    expect(view.all('button.iw-wikilink-open')).toHaveLength(0)
    await view.unmount()
  })

  it('counts related cards in English and marks ids the library does not hold', async () => {
    const view = await mount(<LibraryPanel api={stubApi()} localeId="en-US" />)
    await expandGroups(view)
    await view.click(defined(view.all('button.iw-row').find(button => button.textContent?.includes('创造性判断的三步法'))))
    expect(view.text()).toContain('Related · 2')
    expect(view.all('span.iw-related-unresolved')).toHaveLength(2)
    expect(view.text()).toContain('not in library')
    expect(view.all('section.iw-related button')).toHaveLength(0)
    await view.unmount()
  })

  it('keeps delete disabled while a refresh is in flight', async () => {
    const base = stubApi()
    let reads = 0
    const api: HostApi = {
      ...base,
      fetchTree: () => {
        reads += 1
        return reads > 1 ? new Promise<LibraryTree>(() => {}) : Promise.resolve(TREE)
      },
    }
    const view = await mount(<LibraryPanel api={api} localeId="zh-CN" />)
    await expandGroups(view)
    await view.click(defined(view.all('button.iw-row').find(button => button.textContent?.includes('创造性判断的三步法'))))
    const deleteButton = (): HTMLButtonElement => {
      const found = view.one('.iw-read .iw-read-actions button')
      if (!(found instanceof HTMLButtonElement)) throw new Error('expected the delete button')
      return found
    }
    expect(deleteButton().disabled).toBe(false)
    await view.click(defined(view.all('button.iw-btn').find(button => button.textContent === '刷新')))
    expect(deleteButton().disabled).toBe(true)
    expect(deleteButton().className).toContain('iw-btn-danger')
    await view.unmount()
  })
})
