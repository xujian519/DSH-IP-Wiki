// @vitest-environment jsdom
/** The Markdown renderer: the block kinds reports and cards contain. */
import { describe, expect, it } from 'vitest'
import { Markdown, parseBlocks, type WikilinkAccess } from '../src/client/markdown'
import { defined, mount } from './dom'

describe('parseBlocks', () => {
  it('reads headings by level', () => {
    expect(parseBlocks('# 一\n## 二\n###### 六')).toEqual([
      { kind: 'heading', level: 1, text: '一' },
      { kind: 'heading', level: 2, text: '二' },
      { kind: 'heading', level: 6, text: '六' },
    ])
  })

  it('reads unordered and ordered lists as separate blocks', () => {
    expect(parseBlocks('- a\n- b\n\n1. c\n2. d')).toEqual([
      { kind: 'list', ordered: false, items: ['a', 'b'] },
      { kind: 'list', ordered: true, items: ['c', 'd'] },
    ])
  })

  it('reads a fenced block, including an unterminated one', () => {
    expect(parseBlocks('```\ncode\n```')).toEqual([{ kind: 'code', lines: ['code'] }])
    expect(parseBlocks('```\ntail')).toEqual([{ kind: 'code', lines: ['tail'] }])
  })

  it('reads a table with its header and rows', () => {
    expect(parseBlocks('| a | b |\n| --- | --- |\n| 1 | 2 |')).toEqual([
      { kind: 'table', header: ['a', 'b'], rows: [['1', '2']] },
    ])
  })

  it('reads a quote block', () => {
    expect(parseBlocks('> 引用\n> 续行')).toEqual([{ kind: 'quote', lines: ['引用', '续行'] }])
  })

  it('joins consecutive lines into one paragraph and stops at a block', () => {
    expect(parseBlocks('第一行\n第二行\n\n# 标题\n正文')).toEqual([
      { kind: 'paragraph', lines: ['第一行', '第二行'] },
      { kind: 'heading', level: 1, text: '标题' },
      { kind: 'paragraph', lines: ['正文'] },
    ])
  })

  it('keeps a pipe line that is not a table as a paragraph', () => {
    expect(parseBlocks('| 单行 |')).toEqual([{ kind: 'paragraph', lines: ['| 单行 |'] }])
  })

  it('ends a paragraph where a table starts', () => {
    expect(parseBlocks('正文\n| a | b |\n| --- | --- |\n| 1 | 2 |')).toEqual([
      { kind: 'paragraph', lines: ['正文'] },
      { kind: 'table', header: ['a', 'b'], rows: [['1', '2']] },
    ])
  })

  it('keeps consecutive pipe lines without a separator in one paragraph', () => {
    expect(parseBlocks('| 单行 |\n| 两行 |')).toEqual([
      { kind: 'paragraph', lines: ['| 单行 |', '| 两行 |'] },
    ])
  })

  it('reads a heading with trailing text trimmed off its marks', () => {
    expect(parseBlocks('##   间距标题')).toEqual([{ kind: 'heading', level: 2, text: '间距标题' }])
  })

  it('ends a paragraph where each other block kind starts', () => {
    const kinds = parseBlocks([
      '正文一',
      '# 标题',
      '正文二',
      '- 项',
      '正文三',
      '> 引用',
      '正文四',
      '```',
      'code',
      '```',
      '正文五',
      '1. 序号',
    ].join('\n')).map(block => block.kind)
    expect(kinds).toEqual([
      'paragraph', 'heading',
      'paragraph', 'list',
      'paragraph', 'quote',
      'paragraph', 'code',
      'paragraph', 'list',
    ])
  })
})

describe('Markdown', () => {
  it('renders every block kind', async () => {
    const text = [
      '# 一级标题',
      '',
      '正文 **加粗** 与 `代码` 与 [[双链]] 与 [链接](https://example.com)。',
      '',
      '- 无序项',
      '',
      '1. 有序项',
      '',
      '> 引用行',
      '',
      '```',
      'fenced',
      '```',
      '',
      '| 步骤 | 内容 |',
      '| --- | --- |',
      '| 1 | 最接近现有技术 |',
      '',
      '## 二级标题',
      '',
      '### 三级标题',
    ].join('\n')
    const view = await mount(<Markdown text={text} />)
    // One class per heading level, one DOM level below the reader's own title, so
    // a five-level card outline stays readable instead of collapsing to one size.
    expect(view.all('h3.iw-md-h1')).toHaveLength(1)
    expect(view.all('h4.iw-md-h2')).toHaveLength(1)
    expect(view.all('h5.iw-md-h3')).toHaveLength(1)
    expect(view.all('strong')).toHaveLength(1)
    expect(view.all('code.iw-code')).toHaveLength(1)
    expect(view.all('span.iw-wikilink')).toHaveLength(1)
    expect(view.one('a').getAttribute('href')).toBe('https://example.com')
    expect(view.all('ul.iw-md-list')).toHaveLength(1)
    expect(view.all('ol.iw-md-list')).toHaveLength(1)
    expect(view.all('blockquote.iw-md-quote')).toHaveLength(1)
    expect(view.one('pre.iw-md-pre').textContent).toBe('fenced')
    expect(view.all('table.iw-md-table th')).toHaveLength(2)
    expect(view.all('table.iw-md-table tbody td')).toHaveLength(2)
    await view.unmount()
  })

  it('renders trailing text after the last inline token', async () => {
    const view = await mount(<Markdown text="**前** 后" />)
    expect(view.text()).toBe('前 后')
    await view.unmount()
  })

  it('renders an empty document as no blocks', async () => {
    const view = await mount(<Markdown text="" />)
    expect(view.container.textContent).toBe('')
    await view.unmount()
  })
})

describe('wikilinks', () => {
  /** A resolver for a library holding one trademark card. */
  function access(opened: string[]): WikilinkAccess {
    const pages: Record<string, string> = { 商标法: 'cards/statute/trademark.md' }
    return {
      resolve: name => pages[name],
      open: path => { opened.push(path) },
    }
  }

  it('resolves the page behind an Obsidian anchor and label', async () => {
    // Obsidian writes `[[page#section|label]]`: the reference is the page, the label is
    // what the reader reads. Measured on the real library, 400 of its 5,513 body links
    // only resolve once the anchor and the label come off, and 550 alias links would
    // otherwise print their own `page|label` markup.
    const opened: string[] = []
    const view = await mount(
      <Markdown
        text={[
          '[[商标法#第十一条-显著性|商标法第11条 - 显著性]]',
          '',
          '[[商标法#第十一条-显著性]]',
          '',
          '[[未知页|另一个名字]]',
          '',
          '[[商标法|]]',
        ].join('\n')}
        wikilink={access(opened)}
      />,
    )
    expect(view.all('button.iw-wikilink-open').map(button => button.textContent)).toEqual([
      '商标法第11条 - 显著性',
      // No label, so the anchor stays visible rather than being silently dropped.
      '商标法#第十一条-显著性',
      // An empty label is no label: showing nothing would leave an invisible control.
      '商标法',
    ])
    expect(view.all('span.iw-wikilink').map(span => span.textContent)).toEqual(['另一个名字'])
    await view.click(defined(view.all('button.iw-wikilink-open')[0]))
    expect(opened).toEqual(['cards/statute/trademark.md'])
    await view.unmount()
  })

  it('leaves every wikilink plain text when no resolver is given', async () => {
    const view = await mount(<Markdown text="见 [[商标法#第十一条-显著性|商标法第11条]]。" />)
    expect(view.all('button.iw-wikilink-open')).toEqual([])
    expect(view.all('span.iw-wikilink').map(span => span.textContent)).toEqual(['商标法第11条'])
    await view.unmount()
  })
})
