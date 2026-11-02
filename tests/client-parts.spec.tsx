// @vitest-environment jsdom
/** The panel's smaller client modules: the icon, the dictionaries, and the stylesheet. */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { IpWikiIcon } from '../src/client/IpWikiIcon'
import { NAMESPACE, dictionaryFor, en, zh } from '../src/client/locales'
import { libraryStyles } from '../src/client/styles'
import { mount } from './dom'

describe('IpWikiIcon', () => {
  it('draws at the edge the sidebar asks for', async () => {
    const view = await mount(<IpWikiIcon size={18} active />)
    const svg = view.one('svg')
    expect(svg.getAttribute('width')).toBe('18')
    expect(svg.getAttribute('height')).toBe('18')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    await view.unmount()
  })
})

describe('dictionaries', () => {
  it('carries the same keys in both languages', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('picks the dictionary by locale id', () => {
    expect(dictionaryFor('en-US').panel).toBe('IP Knowledge Wiki')
    expect(dictionaryFor('EN').panel).toBe('IP Knowledge Wiki')
    expect(dictionaryFor('zh-CN').panel).toBe('IP 知识库')
    expect(dictionaryFor('fr').panel).toBe('IP 知识库')
  })

  it('registers under the plugin namespace', () => {
    expect(NAMESPACE).toBe('dsh-ip-wiki')
  })

  it('names the gate strip apart from a lifecycle draft and a pending draft', () => {
    expect(zh.lintStripPass).toBe('门禁通过')
    expect(zh.lintStripFail).toBe('门禁未通过')
    expect(zh.lintStripCritical).toBe('严重')
    expect(zh.lintStripWarning).toBe('警告')
    expect(en.lintStripPass).toBe('Gate passed')
    expect(en.lintStripFail).toBe('Gate failed')
    expect(en.lintStripCritical).toBe('critical')
    expect(en.lintStripWarning).toBe('warning')
    expect(zh.statusDraft).toBe('草稿')
    expect(zh.drafts).toBe('待确认草稿')
    expect(en.statusDraft).toBe('Draft')
    expect(en.drafts).toBe('Pending drafts')
  })
})

describe('libraryStyles', () => {
  it('styles with theme tokens rather than literal colours', () => {
    const css = libraryStyles()
    expect(css).toContain('var(--dsw-alias-bg-base)')
    expect(css).toContain('var(--dsw-alias-label-primary)')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/iu)
  })

  it('keeps neutral fills visible in light mode, where the three surface tokens are white', () => {
    const css = libraryStyles()
    // bg-base, bg-layer-1 and bg-layer-2 are all rgb(255,255,255) in light mode, so
    // a hover or a table head painted with them reads as no change at all.
    expect(css).toContain('var(--dsw-alias-interactive-bg-hover)')
    expect(css).toContain('background: color-mix(in srgb, var(--dsw-alias-label-primary)')
    expect(css).not.toContain('background: var(--dsw-alias-bg-layer-')
  })

  it('keeps the host hairline, focus, and link rules', () => {
    const css = libraryStyles()
    expect(css).toContain('0.5px solid var(--dsw-alias-border-l1)')
    expect(css).toContain(':focus-visible')
    // The panel used to remove the one focus ring it had.
    expect(css).not.toContain('outline: none')
    expect(css).toContain('var(--dsw-alias-link)')
    // Feature CSS tops out at 500, except the merged h3 tier: its weight steps
    // to 600 so a scan can find it. Colour and size stay the secondary tier.
    const feature = css.replace(/\.iw-md-h3 \{[^}]*\}/u, '')
    expect(feature).not.toContain('font-weight: 600')
    expect(css).toMatch(/\.iw-md-h3 \{[^}]*font-weight: 600/u)
    expect(css).toMatch(/\.iw-md-h3 \{[^}]*font-size: 13px/u)
    expect(css).toMatch(/\.iw-md-h3 \{[^}]*margin: 20px 0 6px/u)
    expect(css).toMatch(/\.iw-md-h3 \{[^}]*color: var\(--dsw-alias-label-secondary\)/u)
  })

  it('states card status as a dot rather than as state-coloured text', () => {
    const css = libraryStyles()
    expect(css).toContain('.iw-chip-warn::before')
    expect(css).toContain('.iw-chip-ok::before')
    // warn is 2.15:1 and success 2.28:1 on white, so neither may ink text, while
    // both keep the dot and any border that carries their hue.
    const inked = css.replace(/border[a-z-]*color: var\(--dsw-alias-state-[a-z-]+\)/gu, '')
    expect(inked).toContain('background: var(--dsw-alias-state-warn-primary)')
    expect(inked).not.toContain('color: var(--dsw-alias-state-warn-primary)')
    expect(inked).not.toContain('color: var(--dsw-alias-state-success-primary)')
  })

  it('measures prose, and keeps a destructive action apart from a read', () => {
    const css = libraryStyles()
    expect(css).toContain('max-width: 40em')
    // The card header shares the prose measure, so a wide window cannot
    // stretch chips, the delete row, the confirm bar, or metadata past 40em.
    for (const selector of ['.iw-meta {', '.iw-read-actions {', '.iw-confirm {', '.iw-details {']) {
      const rule = css.slice(css.indexOf(selector))
      expect(rule.slice(0, rule.indexOf('}'))).toContain('max-width: 40em')
    }
    expect(css).toContain('.iw-btn-danger')
    expect(css).toContain('.iw-btn-quiet')
    expect(css).toContain('.iw-btn-primary')
  })

  it('pins the tree controls and keeps a card row one line tall', () => {
    const css = libraryStyles()
    const tree = css.slice(css.indexOf('.iw-tree {'))
    const treeRule = tree.slice(0, tree.indexOf('}'))
    expect(treeRule).toContain('flex-direction: column')
    expect(treeRule).toContain('overflow: hidden')
    const scroll = css.slice(css.indexOf('.iw-tree-scroll {'))
    expect(scroll.slice(0, scroll.indexOf('}'))).toContain('overflow-y: auto')
    const row = css.slice(css.indexOf('.iw-row-line {'))
    expect(row.slice(0, row.indexOf('}'))).toContain('min-height: 30px')
    // author display:flex 会盖过 [hidden]，必须单独收回，详情收起时第二行才真的不占位。
    expect(css).toContain('.iw-status-extra[hidden] { display: none; }')
  })

  it('gives a search hit its own card and keeps searching distinct from empty', () => {
    const css = libraryStyles()
    expect(css).toContain('.iw-hit {')
    expect(css).toContain('.iw-hit-type {')
    expect(css).toContain('.iw-hit-domain {')
    expect(css).toContain(".iw-hit[data-selected='true']")
    const searching = css.slice(css.indexOf('.iw-searching {'))
    const searchingRule = searching.slice(0, searching.indexOf('}'))
    expect(searchingRule).toContain('text-align: left')
    expect(searchingRule).toContain('border: 0.5px dashed')
    expect(searchingRule).not.toContain('text-align: center')
    const empty = css.slice(css.indexOf('.iw-empty {'))
    const emptyRule = empty.slice(0, empty.indexOf('}'))
    expect(emptyRule).toContain('text-align: center')
    expect(emptyRule).not.toContain('border:')
  })

  it('styles every class the client components use', () => {
    const css = libraryStyles()
    const directory = join(process.cwd(), 'src', 'client')
    const classes = new Set<string>()
    for (const file of readdirSync(directory)) {
      if (!file.endsWith('.tsx')) continue
      const source = readFileSync(join(directory, file), 'utf8')
      for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/gu)) {
        for (const token of (match[1] ?? match[2] ?? '').split(/[\s${}]+/u)) {
          if (token.startsWith('iw-')) classes.add(token)
        }
      }
    }
    expect(classes.size).toBeGreaterThan(10)
    for (const name of classes) expect(css).toContain(`.${name}`)
  })
})
