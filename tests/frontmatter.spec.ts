/** The frontmatter parser: the subset cards use, and what it does outside it. */
import { describe, expect, it } from 'vitest'
import { isMap, numberField, parseFrontmatter, removeFromListField, setFrontmatterFields, textField, textList } from '../src/shared/frontmatter'
import { RULE_CARD } from './fixtures'

describe('removeFromListField', () => {
  /** A card whose references are written as a block list, the imported form. */
  const BLOCK = `---\nid: "a"\nrelated_concepts:\n  - "keep"\n  - "drop"\n  - "also"\n---\n\n# a\n`

  it('removes one item of a block list and keeps every other byte', () => {
    const next = removeFromListField(BLOCK, 'related_concepts', 'drop')
    expect(next).toBe(`---\nid: "a"\nrelated_concepts:\n  - "keep"\n  - "also"\n---\n\n# a\n`)
    expect(textList(parseFrontmatter(next ?? '').fields, 'related_concepts')).toEqual(['keep', 'also'])
  })

  it('collapses the field when the last item goes', () => {
    const only = `---\nid: "a"\nrelated_concepts:\n  - "drop"\n---\n\n# a\n`
    const next = removeFromListField(only, 'related_concepts', 'drop')
    expect(next).toBe(`---\nid: "a"\nrelated_concepts: []\n---\n\n# a\n`)
    expect(textList(parseFrontmatter(next ?? '').fields, 'related_concepts')).toEqual([])
  })

  it('leaves an inline list alone, because this dialect parses one as text', () => {
    const flow = `---\nid: "a"\nrelated_concepts: ["keep", "drop"]\n---\n\n# a\n`
    // `textList` reads this field as empty, so it holds no reference to remove.
    expect(textList(parseFrontmatter(flow).fields, 'related_concepts')).toEqual([])
    expect(removeFromListField(flow, 'related_concepts', 'drop')).toBeUndefined()
  })

  it('removes an unquoted item and a single-quoted one', () => {
    // The library quotes what it writes, but a hand-written card need not.
    const bare = `---\nid: "a"\nrelated_concepts:\n  - keep\n  - drop\n---\n\n# a\n`
    expect(removeFromListField(bare, 'related_concepts', 'drop'))
      .toBe(`---\nid: "a"\nrelated_concepts:\n  - keep\n---\n\n# a\n`)
    const single = `---\nid: "a"\nrelated_concepts:\n  - 'drop'\n---\n\n# a\n`
    expect(removeFromListField(single, 'related_concepts', 'drop'))
      .toBe(`---\nid: "a"\nrelated_concepts: []\n---\n\n# a\n`)
  })

  it('leaves a field alone when it does not carry the value', () => {
    expect(removeFromListField(BLOCK, 'related_concepts', 'absent')).toBeUndefined()
    expect(removeFromListField('---\na: []\n---\n\nx\n', 'a', 'drop')).toBeUndefined()
    expect(removeFromListField('---\na:\n  b: "drop"\n---\n\nx\n', 'a', 'drop')).toBeUndefined()
    expect(removeFromListField('---\na: "drop"\n---\n\nx\n', 'a', 'drop')).toBeUndefined()
    expect(removeFromListField('---\na:\n---\n\nx\n', 'a', 'drop')).toBeUndefined()
    // A line that carries no field name at all is copied through untouched.
    const commented = `---\n# 这是一行注释\nrelated_concepts:\n  - "drop"\nid: "a"\n---\n\nx\n`
    expect(removeFromListField(commented, 'related_concepts', 'drop'))
      .toBe(`---\n# 这是一行注释\nrelated_concepts: []\nid: "a"\n---\n\nx\n`)
  })

  it('refuses a document it cannot edit', () => {
    expect(() => removeFromListField('# no frontmatter\n', 'a', 'b')).toThrow('no frontmatter block')
    expect(() => removeFromListField('---\na: "b"\n', 'a', 'b')).toThrow('never closes')
  })
})

describe('parseFrontmatter', () => {
  it('reads the nested, quoted, and list constructs a card uses', () => {
    const { fields, body } = parseFrontmatter(RULE_CARD)
    expect(textField(fields, 'id')).toBe('rule-1')
    expect(textField(fields, 'type')).toBe('rule')
    expect(numberField(fields, 'quality')).toBe(0.92)
    expect(fields['needs_review']).toBe(true)
    expect(textList(fields, 'related_concepts')).toEqual(['old-1', 'old-2'])
    expect(textList(fields, 'law_refs')).toEqual(['专利法第 22 条第 3 款'])
    expect(textList(fields, 'supersedes')).toEqual([])
    const source = fields['source']
    expect(isMap(source) ? source['kind'] : undefined).toBe('vault-card')
    expect(body.startsWith('\n# 创造性判断的三步法')).toBe(true)
  })

  it('returns the source untouched when there is no block', () => {
    expect(parseFrontmatter('# 只有正文\n')).toEqual({ fields: {}, body: '# 只有正文\n' })
  })

  it('returns the source untouched when the block never closes', () => {
    const text = '---\nid: x\n\n# 正文\n'
    expect(parseFrontmatter(text)).toEqual({ fields: {}, body: text })
  })

  it('skips comments and blank lines inside the block', () => {
    const { fields } = parseFrontmatter('---\n# 注释\n\nid: "a"\n\n---\n正文\n')
    expect(fields).toEqual({ id: 'a' })
  })

  it('skips an indented line that has no field above it', () => {
    const { fields } = parseFrontmatter('---\n  orphan: 1\nid: "a"\n---\n正文\n')
    expect(fields).toEqual({ id: 'a' })
  })

  it('reads an empty value as null and a nested block as a map', () => {
    const { fields } = parseFrontmatter('---\nempty:\nnested:\n  a: 1\n  b: "2"\n---\n正文\n')
    expect(fields['empty']).toBeNull()
    const nested = fields['nested']
    expect(isMap(nested) ? nested['a'] : undefined).toBe(1)
  })

  it('reads lists of scalars, quoted items, and nested blocks', () => {
    const { fields } = parseFrontmatter([
      '---',
      'items:',
      "  - '单引号'",
      '  - 2',
      '  - true',
      'blocks:',
      '  -',
      '    a: 1',
      'named:',
      '  - key:',
      '      b: 2',
      '---',
      '正文',
    ].join('\n'))
    expect(textList(fields, 'items')).toEqual(['单引号'])
    expect(fields['items']).toEqual(['单引号', 2, true])
    expect(fields['blocks']).toEqual([{ a: 1 }])
    expect(fields['named']).toEqual([{ key: { b: 2 } }])
  })

  it('ignores a line with no colon outside a list', () => {
    const { fields } = parseFrontmatter('---\nnot a field\nid: "a"\n---\n正文\n')
    expect(fields).toEqual({ id: 'a' })
  })

  it('keeps a quoted value whose quotes are unbalanced as text', () => {
    const { fields } = parseFrontmatter('---\nid: "unbalanced\n---\n正文\n')
    expect(fields['id']).toBe('"unbalanced')
  })

  it('reads the null spellings as null', () => {
    const { fields } = parseFrontmatter('---\na: null\nb: ~\n---\n正文\n')
    expect(fields['a']).toBeNull()
    expect(fields['b']).toBeNull()
  })

  it('reads empty map and list literals', () => {
    const { fields } = parseFrontmatter('---\na: []\nb: {}\n---\n正文\n')
    expect(fields['a']).toEqual([])
    expect(fields['b']).toEqual({})
  })

  it('reads the boolean false', () => {
    const { fields } = parseFrontmatter('---\nflag: false\n---\n正文\n')
    expect(fields['flag']).toBe(false)
  })

  it('ignores a line whose key is empty', () => {
    const { fields } = parseFrontmatter('---\n: 无键\nid: "a"\n---\n正文\n')
    expect(fields).toEqual({ id: 'a' })
  })

  it('reads a bare dash as an empty item beside a valued one', () => {
    const { fields } = parseFrontmatter('---\nitems:\n  -\n  - x\n---\n正文\n')
    expect(fields['items']).toEqual([null, 'x'])
  })

  it('skips a non-item line that follows list items', () => {
    const { fields } = parseFrontmatter('---\nitems:\n  - x\n  stray: 2\n---\n正文\n')
    expect(fields['items']).toEqual(['x'])
  })

  it('attaches a ragged deeper block to the field above it', () => {
    const { fields } = parseFrontmatter('---\na: 1\n  b: 2\n c: 3\n---\n正文\n')
    expect(fields).toEqual({ a: { b: 2, c: 3 } })
  })

  it('reads a block whose first line is a list item as no fields', () => {
    const { fields, body } = parseFrontmatter('---\n- a\n---\n正文\n')
    expect(fields).toEqual({})
    expect(body).toBe('正文\n')
  })

  it('reads a block opened by a fence with trailing spaces', () => {
    const { fields } = parseFrontmatter('---  \nid: "a"\n---\n正文\n')
    expect(fields).toEqual({ id: 'a' })
  })

  it('reads an empty block as no fields and the body after it', () => {
    expect(parseFrontmatter('---\n---\n正文\n')).toEqual({ fields: {}, body: '正文\n' })
  })
})

describe('field readers', () => {
  it('reject values of the wrong type', () => {
    const { fields } = parseFrontmatter('---\ntext: "a"\nnum: 2\nlist:\n  - x\n---\n正文\n')
    expect(textField(fields, 'num')).toBeUndefined()
    expect(numberField(fields, 'text')).toBeUndefined()
    expect(textList(fields, 'text')).toEqual([])
    expect(textList(fields, 'list')).toEqual(['x'])
  })

  it('treat a missing field as absent', () => {
    expect(textField({}, 'id')).toBeUndefined()
    expect(numberField({}, 'id')).toBeUndefined()
    expect(textList({}, 'id')).toEqual([])
  })
})

describe('isMap', () => {
  it('separates maps from the other value kinds', () => {
    expect(isMap({ a: 1 })).toBe(true)
    expect(isMap([1])).toBe(false)
    expect(isMap('a')).toBe(false)
    expect(isMap(null)).toBe(false)
    expect(isMap(undefined)).toBe(false)
  })
})

describe('setFrontmatterFields', () => {
  const CARD = [
    '---',
    'id: "a"',
    'status: "draft"',
    'nested:',
    '  a: 1',
    '---',
    '',
    '# 正文',
    '',
    'status: "不动的正文"',
    '',
  ].join('\n')

  it('replaces a scalar field in place and leaves everything else alone', () => {
    const rewritten = setFrontmatterFields(CARD, { status: '"deprecated"' })
    expect(rewritten).toBe(CARD.replace('status: "draft"', 'status: "deprecated"'))
    expect(parseFrontmatter(rewritten).body).toBe(parseFrontmatter(CARD).body)
  })

  it('appends a field the block does not carry', () => {
    const rewritten = setFrontmatterFields(CARD, { superseded_by: '"cards/rule/merged.md"' })
    expect(parseFrontmatter(rewritten).fields['superseded_by']).toBe('cards/rule/merged.md')
    expect(rewritten).toContain('superseded_by: "cards/rule/merged.md"\n---')
  })

  it('leaves a nested key of the same name alone', () => {
    const rewritten = setFrontmatterFields(CARD, { a: '"1"' })
    expect(rewritten).toContain('  a: 1')
    expect(rewritten).toContain('a: "1"')
  })

  it('skips lines that are not top-level fields', () => {
    const messy = ['---', '- 列表项', ': 没有键', 'a b: 1', 'id: "a"', '---', '正文'].join('\n')
    const rewritten = setFrontmatterFields(messy, { id: '"b"', 列表项: '"x"' })
    expect(rewritten).toContain('- 列表项')
    expect(rewritten).toContain(': 没有键')
    expect(rewritten).toContain('a b: 1')
    expect(rewritten).toContain('id: "b"')
    expect(rewritten).toContain('列表项: "x"')
  })

  it('refuses a document with no frontmatter block', () => {
    expect(() => setFrontmatterFields('# 只有正文\n', { status: '"x"' }))
      .toThrow(/has no frontmatter block/u)
  })

  it('refuses a block that never closes', () => {
    expect(() => setFrontmatterFields('---\nid: "a"\n', { status: '"x"' }))
      .toThrow(/never closes/u)
  })
})
