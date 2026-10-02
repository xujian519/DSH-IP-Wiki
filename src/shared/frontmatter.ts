/**
 * The frontmatter subset this library's cards use: a leading `---` block whose
 * body is maps, lists of scalars, and scalars.
 *
 * A card is content, not configuration, so an unsupported construct must not
 * abort a page: the parser reads the subset the migration writes and the subset a
 * hand edit keeps, and steps over anything else without inventing a value.
 * `undefined` in the result means "this line carried no value".
 * @module dsh-ip-wiki/shared/frontmatter
 */

/** A parsed frontmatter value. */
export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | readonly FrontmatterValue[]
  | { readonly [key: string]: FrontmatterValue }

/** A parsed frontmatter block, keyed by its top-level field names. */
export type Frontmatter = { readonly [key: string]: FrontmatterValue }

/**
 * Whether a value is a nested map rather than a scalar or a list.
 * @param value - any parsed value, or `undefined` for an absent field.
 * @returns true when the value is a map.
 */
export function isMap(value: unknown): value is { readonly [key: string]: FrontmatterValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One source line with its indentation, or `undefined` once the block ends. */
interface RawLine {
  readonly indent: number
  readonly text: string
}

/** One line of the indentation tree. */
interface TreeNode {
  readonly text: string
  readonly children: TreeNode[]
}

/** Indentation of a line, counting spaces only. */
function indentOf(line: string): number {
  let count = 0
  while (count < line.length && line[count] === ' ') count += 1
  return count
}

/** Content lines of the frontmatter block, comments and blanks removed. */
function contentLines(block: readonly string[]): RawLine[] {
  const lines: RawLine[] = []
  for (const raw of block) {
    const indent = indentOf(raw)
    const text = raw.slice(indent).trimEnd()
    if (text === '' || text.startsWith('#')) continue
    lines.push({ indent, text })
  }
  return lines
}

/**
 * Fold an indented line list into one tree.
 * @param lines - content lines in file order.
 * @param from - index to start at.
 * @param indent - indentation of the nodes this call owns.
 * @returns the nodes and the index after them.
 */
function buildNodes(lines: readonly RawLine[], from: number, indent: number): [TreeNode[], number] {
  const nodes: TreeNode[] = []
  let index = from
  while (index < lines.length) {
    const line = lines[index]
    if (line === undefined || line.indent < indent) break
    if (line.indent > indent) {
      // Deeper than the node list owns: attach to the previous node when there is
      // one, otherwise skip the orphan rather than dropping the rest of the block.
      const previous = nodes[nodes.length - 1]
      if (previous === undefined) {
        index += 1
        continue
      }
      const [children, next] = buildNodes(lines, index, line.indent)
      previous.children.push(...children)
      index = next
      continue
    }
    // A node's block is every following line indented deeper than it, whatever
    // that depth is: cards indent list items by two spaces and nested keys by two
    // as well, so the child call takes the child's own indentation.
    const following = lines[index + 1]
    let children: TreeNode[] = []
    let after = index + 1
    if (following !== undefined && following.indent > indent) {
      const built = buildNodes(lines, index + 1, following.indent)
      children = built[0]
      after = built[1]
    }
    nodes.push({ text: line.text, children })
    index = after
  }
  return [nodes, index]
}

/** Whether a node's text opens a list item, with or without a value after the dash. */
function isItem(text: string): boolean {
  return text === '-' || text.startsWith('- ')
}

/** The text after a list item's dash, or the whole text when it is not an item. */
function itemText(text: string): string {
  return text === '-' ? '' : text.slice(2)
}

/** One scalar: quoted strings unquoted, `[]`/`{}` emptied, numbers and booleans typed. */
function scalar(text: string): FrontmatterValue {
  const trimmed = text.trim()
  if (trimmed === '[]') return []
  if (trimmed === '{}') return {}
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null' || trimmed === '~') return null
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if (trimmed.length >= 2 && (first === '"' || first === "'") && last === first) {
    return trimmed.slice(1, -1)
  }
  if (/^-?\d+(?:\.\d+)?$/u.test(trimmed)) return Number(trimmed)
  return trimmed
}

/** Split `key: value` at the first colon that is followed by a space or ends the text. */
function splitField(text: string): [string, string] | undefined {
  const item = isItem(text) ? itemText(text) : text
  const colon = item.indexOf(':')
  if (colon < 0) return undefined
  const key = item.slice(0, colon).trim()
  const rest = item.slice(colon + 1).trim()
  if (key === '') return undefined
  return [key, rest]
}

/** Interpret one node list as a map or a list, decided by its first node. */
function interpret(nodes: readonly TreeNode[]): FrontmatterValue {
  const first = nodes[0]
  if (first === undefined) return {}
  if (isItem(first.text)) {
    const items: FrontmatterValue[] = []
    for (const node of nodes) {
      if (!isItem(node.text)) continue
      const item = itemText(node.text)
      const field = item === '' ? undefined : splitField(node.text)
      if (item === '') {
        // A bare dash is an empty item; with an indented block under it, that
        // block is the item's value.
        items.push(node.children.length === 0 ? null : interpret(node.children))
        continue
      }
      if (node.children.length > 0 && field !== undefined && field[1] === '') {
        // `- key:` starts a map whose remaining keys are the child lines.
        items.push({ [field[0]]: interpret(node.children) })
        continue
      }
      items.push(scalar(item))
    }
    return items
  }
  const map: Record<string, FrontmatterValue> = {}
  for (const node of nodes) {
    const field = splitField(node.text)
    if (field === undefined) continue
    const [key, rest] = field
    if (node.children.length > 0) {
      // An indented block is the field's value: it carries the structure, so a
      // scalar written above it is the contradiction, not the block.
      map[key] = interpret(node.children)
      continue
    }
    map[key] = rest === '' ? null : scalar(rest)
  }
  return map
}

/**
 * Parse a document's leading frontmatter block.
 * @param source - the whole file text.
 * @returns the parsed fields and the body after the closing fence; an absent or
 * unterminated block yields an empty field set and the untouched source.
 */
export function parseFrontmatter(source: string): { fields: Frontmatter; body: string } {
  const opening = /^---[ \t]*\r?\n/u.exec(source)
  if (opening === null) return { fields: {}, body: source }
  const lines = source.slice(opening[0].length).split('\n')
  const block: string[] = []
  let end = -1
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '---') {
      end = index
      break
    }
    block.push(line)
  }
  if (end < 0) return { fields: {}, body: source }
  const [nodes] = buildNodes(contentLines(block), 0, 0)
  const parsed = interpret(nodes)
  const fields: Frontmatter = isMap(parsed) ? parsed : {}
  return { fields, body: lines.slice(end + 1).join('\n') }
}

/**
 * Read one field as text.
 * @param fields - parsed frontmatter.
 * @param key - field name.
 * @returns the string value, or `undefined` when the field is absent or not text.
 */
export function textField(fields: Frontmatter, key: string): string | undefined {
  const value = fields[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * Read one field as a list of text values.
 * @param fields - parsed frontmatter.
 * @param key - field name.
 * @returns the text items; a non-list field yields an empty list.
 */
export function textList(fields: Frontmatter, key: string): string[] {
  const value = fields[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/** One list item or scalar as plain text, mirroring {@link scalar}'s quoting. */
function unquoted(text: string): string {
  const trimmed = text.trim()
  const first = trimmed.charAt(0)
  if (trimmed.length >= 2 && (first === '"' || first === "'") && trimmed.endsWith(first)) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * Remove one value from a top-level list field, leaving every other byte alone.
 *
 * A card writes `related_concepts` as a block list, which is the only list form
 * this dialect parses — an inline `[a, b]` reads back as text, so it cannot hold a
 * reference and is left as written. The field collapses to `[]` when its last item
 * goes, which reads back as an empty list.
 * @param source - the whole document text.
 * @param key - the field name.
 * @param value - the plain text value to remove.
 * @returns the new document text, or `undefined` when the field does not carry that value.
 * @throws {Error} when the document carries no closed frontmatter block.
 */
export function removeFromListField(source: string, key: string, value: string): string | undefined {
  const opening = /^---[ \t]*\r?\n/u.exec(source)
  if (opening === null) {
    throw new Error('dsh-ip-wiki: cannot edit a list field on a document that has no frontmatter block')
  }
  const lines = source.slice(opening[0].length).split('\n')
  let closing = -1
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '---') {
      closing = index
      break
    }
  }
  if (closing < 0) {
    throw new Error('dsh-ip-wiki: cannot edit a list field on a document whose frontmatter block never closes')
  }
  const block = lines.slice(0, closing)
  const rewritten: string[] = []
  const skipped = new Set<number>()
  let removed = false
  for (const [index, line] of block.entries()) {
    if (skipped.has(index)) continue
    const colon = line.indexOf(':')
    // A leading space means a nested key, and anything else is not a field name.
    if (colon < 0 || line.slice(0, colon) !== key) {
      rewritten.push(line)
      continue
    }
    const rest = line.slice(colon + 1).trim()
    if (rest !== '') {
      // A scalar, or the `[]` this function writes: neither carries a list item.
      rewritten.push(line)
      continue
    }
    // The item lines this key owns run until the next line that is not one.
    const tail = block.slice(index + 1)
    const stop = tail.findIndex(text => !/^[ \t]+-[ \t]+/u.test(text))
    const items = stop < 0 ? tail : tail.slice(0, stop)
    const kept = items.filter(item => unquoted(item.replace(/^[ \t]+-[ \t]+/u, '')) !== value)
    if (kept.length === items.length) {
      rewritten.push(line)
      continue
    }
    removed = true
    if (kept.length === 0) rewritten.push(`${key}: []`)
    else rewritten.push(line, ...kept)
    for (const offset of items.keys()) skipped.add(index + 1 + offset)
  }
  if (!removed) return undefined
  return [opening[0] + rewritten.join('\n'), ...lines.slice(closing)].join('\n')
}

/**
 * Read one field as a number.
 * @param fields - parsed frontmatter.
 * @param key - field name.
 * @returns the numeric value, or `undefined` when the field is absent or not numeric.
 */
export function numberField(fields: Frontmatter, key: string): number | undefined {
  const value = fields[key]
  return typeof value === 'number' ? value : undefined
}

/**
 * Rewrite top-level frontmatter fields, leaving every other byte alone.
 *
 * A merge marks the cards it absorbed, and that mark has to be a minimal edit: the
 * body and every untouched field must stay exactly as the user wrote them. A field
 * already present as a scalar line is replaced in place; one that is absent is
 * appended to the end of the block.
 * @param source - the whole document text.
 * @param updates - field names to their new text values.
 * @returns the new document text.
 * @throws {Error} when the document carries no frontmatter block to edit.
 */
export function setFrontmatterFields(source: string, updates: Readonly<Record<string, string>>): string {
  const opening = /^---[ \t]*\r?\n/u.exec(source)
  if (opening === null) {
    throw new Error('dsh-ip-wiki: cannot set frontmatter fields on a document that has no frontmatter block')
  }
  const lines = source.slice(opening[0].length).split('\n')
  let closing = -1
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '---') {
      closing = index
      break
    }
  }
  if (closing < 0) {
    throw new Error('dsh-ip-wiki: cannot set frontmatter fields on a document whose frontmatter block never closes')
  }
  const block = lines.slice(0, closing)
  const remaining = new Map(Object.entries(updates))
  const rewritten = block.map((line) => {
    const colon = line.indexOf(':')
    if (colon < 0) return line
    const name = line.slice(0, colon).trim()
    // A leading space means a nested key, and anything else is not a field name.
    if (name !== line.slice(0, colon) || name === '' || !/^[A-Za-z0-9_-]+$/u.test(name)) return line
    const value = remaining.get(name)
    if (value === undefined) return line
    remaining.delete(name)
    return `${name}: ${value}`
  })
  for (const [name, value] of remaining) rewritten.push(`${name}: ${value}`)
  return [opening[0] + rewritten.join('\n'), ...lines.slice(closing)].join('\n')
}
