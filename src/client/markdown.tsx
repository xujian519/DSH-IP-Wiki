/**
 * A compact Markdown renderer for card bodies and reports.
 *
 * It renders the block kinds this library actually contains — headings,
 * paragraphs, ordered and unordered lists, block quotes, fenced code, and the
 * pipe tables the reports are built from — plus inline bold, code, links, and
 * wikilinks, which cards use for cross-references. Anything outside that set
 * renders as its own text rather than being dropped.
 * @module dsh-ip-wiki/client/markdown
 */
import { useMemo, type ReactNode } from 'react'

/** One rendered block. */
type Block =
  | { readonly kind: 'heading'; readonly level: number; readonly text: string }
  | { readonly kind: 'paragraph'; readonly lines: readonly string[] }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly kind: 'quote'; readonly lines: readonly string[] }
  | { readonly kind: 'code'; readonly lines: readonly string[] }
  | { readonly kind: 'table'; readonly header: readonly string[]; readonly rows: readonly (readonly string[])[] }

/** How a rendered body reaches the cards it links to. */
export interface WikilinkAccess {
  /**
   * Find the card one link names.
   * @param name - the target as the document wrote it: a card id or a page name.
   * @returns the linked card's library path, or `undefined` when nothing matches.
   */
  readonly resolve: (name: string) => string | undefined
  /**
   * Open the card a resolved link names.
   * @param path - the resolved library path.
   */
  readonly open: (path: string) => void
}

/** One heading a body carries, with the id its rendered element takes. */
export interface BodyHeading {
  /** Element id of the rendered heading. */
  readonly id: string
  /** Heading level, 1 through 6. */
  readonly level: number
  /** Heading text. */
  readonly text: string
}

/** What the Markdown renderer is given. */
export interface MarkdownProps {
  /** The Markdown source. */
  readonly text: string
  /**
   * A heading this body repeats from the title above it. The first block is left
   * unrendered when it is a heading carrying exactly this text, so a card whose
   * body starts with its own title does not show it twice.
   */
  readonly omitLeadingHeading?: string
  /** How to reach the cards this body links to, when the caller can. */
  readonly wikilink?: WikilinkAccess
}

/** The element id one block index renders with. */
function headingId(index: number): string {
  return `iw-h${String(index)}`
}

/**
 * The headings a body carries, in reading order.
 * @param text - the Markdown source.
 * @returns each heading with the id {@link Markdown} gives its element.
 */
export function headingsOf(text: string): BodyHeading[] {
  const headings: BodyHeading[] = []
  for (const [index, block] of parseBlocks(text).entries()) {
    if (block.kind === 'heading') headings.push({ id: headingId(index), level: block.level, text: block.text })
  }
  return headings
}

/** The line at an index, or empty text past either end of the document. */
function lineAt(lines: readonly string[], index: number): string {
  return lines[index] ?? ''
}

/** Split one table row into its cells. */
function cells(line: string): string[] {
  return line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split('|').map(cell => cell.trim())
}

/** Whether a line is a table's dash separator. */
function isSeparator(line: string): boolean {
  return /^\|?[\s:|-]*-[\s:|-]*\|?$/u.test(line.trim()) && line.includes('-')
}

/** Whether a line opens a block of its own rather than continuing a paragraph. */
function opensBlock(lines: readonly string[], index: number): boolean {
  const trimmed = lineAt(lines, index).trim()
  if (trimmed === '') return true
  if (trimmed.startsWith('```') || trimmed.startsWith('>')) return true
  if (/^#{1,6}\s/u.test(trimmed)) return true
  if (/^[-*]\s+/u.test(trimmed) || /^\d+[.)]\s+/u.test(trimmed)) return true
  return trimmed.startsWith('|') && isSeparator(lineAt(lines, index + 1))
}

/** Whether a line carries a list marker, with or without a number. */
function isListItem(line: string): boolean {
  return /^[-*]\s+/u.test(line) || /^\d+[.)]\s+/u.test(line)
}

/** A list item's text, with its marker removed. */
function itemOf(line: string): string {
  return line.replace(/^[-*]\s+|^\d+[.)]\s+/u, '')
}

/**
 * Group a document into blocks.
 * @param text - the Markdown source.
 * @returns the blocks in reading order.
 */
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  const lines = text.split('\n')
  let index = 0
  while (index < lines.length) {
    const trimmed = lineAt(lines, index).trim()
    if (trimmed === '') {
      index += 1
      continue
    }
    if (trimmed.startsWith('```')) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !lineAt(lines, index).trim().startsWith('```')) {
        body.push(lineAt(lines, index))
        index += 1
      }
      index += 1
      blocks.push({ kind: 'code', lines: body })
      continue
    }
    const heading = /^(#{1,6})\s+/u.exec(trimmed)
    if (heading !== null) {
      const marks = heading[0].trim().length
      blocks.push({ kind: 'heading', level: marks, text: trimmed.slice(marks).trim() })
      index += 1
      continue
    }
    if (trimmed.startsWith('|') && isSeparator(lineAt(lines, index + 1))) {
      const header = cells(trimmed)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lineAt(lines, index).trim().startsWith('|')) {
        rows.push(cells(lineAt(lines, index)))
        index += 1
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }
    if (trimmed.startsWith('>')) {
      const body: string[] = []
      while (index < lines.length && lineAt(lines, index).trim().startsWith('>')) {
        body.push(lineAt(lines, index).trim().replace(/^>\s?/u, ''))
        index += 1
      }
      blocks.push({ kind: 'quote', lines: body })
      continue
    }
    const ordered = /^\d+[.)]\s+/u.test(trimmed)
    if (isListItem(trimmed)) {
      const items: string[] = []
      while (index < lines.length && isListItem(lineAt(lines, index).trim())) {
        items.push(itemOf(lineAt(lines, index).trim()))
        index += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }
    // The line reached here is a paragraph's first line, so the block always
    // consumes at least it; later lines join until one opens a block of its own.
    const paragraph: string[] = [trimmed]
    index += 1
    while (index < lines.length && !opensBlock(lines, index)) {
      paragraph.push(lineAt(lines, index).trim())
      index += 1
    }
    blocks.push({ kind: 'paragraph', lines: paragraph })
  }
  return blocks
}

/** Render one line's inline markup. */
function inline(text: string, keyPrefix: string, wikilink: WikilinkAccess | undefined): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]*\))/gu
  const nodes: ReactNode[] = []
  let cursor = 0
  let index = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index
    if (start > cursor) nodes.push(text.slice(cursor, start))
    const token = match[0]
    const key = `${keyPrefix}-${String(index)}`
    if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key} className="iw-code">{token.slice(1, -1)}</code>)
    } else if (token.startsWith('[[')) {
      const name = token.slice(2, -2)
      const access = wikilink
      const path = access === undefined ? undefined : access.resolve(name)
      // A link the library cannot resolve stays plain text: nothing here is
      // allowed to look clickable and then do nothing.
      if (access === undefined || path === undefined) {
        nodes.push(<span key={key} className="iw-wikilink">{name}</span>)
      } else {
        nodes.push(
          <button
            key={key}
            type="button"
            className="iw-wikilink iw-wikilink-open"
            onClick={() => { access.open(path) }}
          >
            {name}
          </button>,
        )
      }
    } else {
      // The alternation admits exactly the link form here, so the split cannot
      // fail: label between `[` and `](`, url between `](` and `)`.
      const split = token.indexOf('](')
      nodes.push(
        <a key={key} href={token.slice(split + 2, -1)} target="_blank" rel="noreferrer">
          {token.slice(1, split)}
        </a>,
      )
    }
    cursor = start + token.length
    index += 1
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

/**
 * The element and class one Markdown heading level renders as.
 *
 * The reader's own title is the document's first level, so a body heading sits
 * one step below it; the imported corpus nests five levels deep, and every level
 * past the second shares the smallest size.
 * @param level - the Markdown heading level, 1 through 6.
 * @returns the tag to render and the class that carries its size.
 */
function headingOf(level: number): { readonly tag: 'h3' | 'h4' | 'h5'; readonly className: string } {
  if (level === 1) return { tag: 'h3', className: 'iw-md-h1' }
  if (level === 2) return { tag: 'h4', className: 'iw-md-h2' }
  return { tag: 'h5', className: 'iw-md-h3' }
}

/**
 * Render Markdown as themed elements.
 * @param props - the source text.
 * @returns the rendered blocks.
 */
export function Markdown({ text, omitLeadingHeading, wikilink }: MarkdownProps): ReactNode {
  const blocks = useMemo(() => parseBlocks(text), [text])
  return (
    <div className="iw-md">
      {blocks.map((block, index) => {
        const key = `b${String(index)}`
        if (index === 0 && omitLeadingHeading !== undefined && block.kind === 'heading'
          && block.text.trim() === omitLeadingHeading.trim()) {
          return null
        }
        switch (block.kind) {
          case 'heading': {
            const heading = headingOf(block.level)
            const Tag = heading.tag
            return (
              <Tag key={key} id={headingId(index)} className={heading.className}>
                {inline(block.text, key, wikilink)}
              </Tag>
            )
          }
          case 'paragraph':
            return <p key={key} className="iw-md-p">{inline(block.lines.join(' '), key, wikilink)}</p>
          case 'list': {
            const items = block.items.map((item, itemIndex) =>
              <li key={`${key}-${String(itemIndex)}`}>{inline(item, `${key}-${String(itemIndex)}`, wikilink)}</li>)
            return block.ordered
              ? <ol key={key} className="iw-md-list">{items}</ol>
              : <ul key={key} className="iw-md-list">{items}</ul>
          }
          case 'quote':
            return <blockquote key={key} className="iw-md-quote">{inline(block.lines.join(' '), key, wikilink)}</blockquote>
          case 'code':
            return <pre key={key} className="iw-md-pre">{block.lines.join('\n')}</pre>
          case 'table':
            return (
              <div key={key} className="iw-md-tablewrap">
                <table className="iw-md-table">
                  <thead>
                    <tr>{block.header.map((cell, cellIndex) =>
                      <th key={`${key}-h${String(cellIndex)}`}>{inline(cell, `${key}-h${String(cellIndex)}`, wikilink)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={`${key}-r${String(rowIndex)}`}>{row.map((cell, cellIndex) =>
                        <td key={`${key}-r${String(rowIndex)}c${String(cellIndex)}`}>{inline(cell, `${key}-r${String(rowIndex)}c${String(cellIndex)}`, wikilink)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        }
      })}
    </div>
  )
}
