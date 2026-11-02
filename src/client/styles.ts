/**
 * The panel's stylesheet.
 *
 * Classes are prefixed `iw-` so they cannot collide with host styles, and every
 * colour comes from a theme token, so the panel follows light and dark mode
 * without a second palette.
 *
 * Three rules shape this sheet, all of them the host's own
 * (`docs/web-styling.md`, `.agents/skills/dsh-client-ui-ux/SKILL.md`):
 *
 * 1. **Neutral fills are derived from ink, never from the surface tokens.** In
 *    light mode `--dsw-alias-bg-base`, `-bg-layer-1` and `-bg-layer-2` are all
 *    `rgb(255,255,255)`, so a hover or a table head painted with them is
 *    invisible; every neutral fill here is `--dsw-alias-interactive-bg-hover` or
 *    a `color-mix()` of `--dsw-alias-label-primary` instead.
 * 2. **Hue belongs to state, not to decoration.** The four `state-*` colours
 *    carry the state of a card or a finding; `--dsw-alias-brand-primary` is ink
 *    (it equals `--dsw-alias-label-primary` in both palettes) and is never used
 *    as a filled surface.
 * 3. **Long-form prose takes the theme's markdown typography.** Sizes and the
 *    code font come from the `--dsw-font-markdown-*` tokens, so the reader
 *    follows the same content-font preference as the rest of the client.
 *
 * @module dsh-ip-wiki/client/styles
 */

/**
 * The stylesheet the panel renders beside its markup.
 * @returns one CSS document.
 */
export function libraryStyles(): string {
  return `
.iw-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}
/* Title row and tree column share the host's sidebar fill, which is the one
   neutral surface that differs from the base in both palettes. */
.iw-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
  background: var(--dsw-specific-sidebar-fill);
}
/* 状态条两档：默认一行，详情另起一行。列方向让详情行落在芯片行下面。 */
.iw-status {
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  padding: 6px 12px;
  background: transparent;
}
.iw-status-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.iw-status-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 1px 7px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
}
.iw-status-toggle:hover { color: var(--dsw-alias-label-primary); }
.iw-status-extra {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-top: 6px;
  border-top: 0.5px solid var(--dsw-alias-border-l1);
}
/* author 的 display:flex 会盖过 UA 的 [hidden]，这里用更高优先级把它收回去。 */
.iw-status-extra[hidden] { display: none; }
.iw-banner { padding: 6px 12px; background: transparent; }
.iw-title { font-size: 20px; line-height: 28px; font-weight: 500; }
.iw-root-path {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 46ch;
}
.iw-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent);
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
.iw-chip b { color: var(--dsw-alias-label-primary); font-weight: 500; font-variant-numeric: tabular-nums; }
/* State chips state their hue as a dot; the text stays on ink, because the
   state colours sit between 2.15:1 and 4.50:1 on white as text. */
.iw-chip-warn::before, .iw-chip-error::before, .iw-chip-ok::before {
  content: '';
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  corner-shape: round;
}
.iw-chip-warn::before { background: var(--dsw-alias-state-warn-primary); }
.iw-chip-error::before { background: var(--dsw-alias-state-error-primary); }
.iw-chip-ok::before { background: var(--dsw-alias-state-success-primary); }
.iw-spacer { flex: 1; }
.iw-btn {
  padding: 5px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.iw-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
/* Reading and navigation: no fill, secondary ink, so they cannot be mistaken
   for the actions that write to the library. */
.iw-btn-quiet { border-color: transparent; background: transparent; color: var(--dsw-alias-label-secondary); }
.iw-btn-quiet:hover { color: var(--dsw-alias-label-primary); }
/* The one action that lands a draft. */
.iw-btn-primary {
  border-color: var(--dsw-alias-button-primary-fill);
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-inverted);
}
.iw-btn-primary:hover { background: var(--dsw-alias-button-primary-fill); opacity: 0.9; }
/* Discarding a draft destroys it and cannot be reverted, so it never wears the
   same clothes as a read. */
.iw-btn-danger {
  border-color: var(--dsw-alias-state-error-primary);
  background: transparent;
  color: var(--dsw-alias-state-error-primary);
}
.iw-btn-danger:hover { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.iw-btn:disabled { opacity: 0.55; cursor: default; }
.iw-btn:disabled:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent); }
.iw-input:focus-visible, .iw-btn:focus-visible, .iw-status-toggle:focus-visible, .iw-row:focus-visible, .iw-group-head:focus-visible, .iw-hit-open:focus-visible, .iw-hit-source summary:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.iw-row:focus-visible, .iw-group-head:focus-visible, .iw-hit-open:focus-visible { outline-offset: -2px; }
@media (prefers-reduced-motion: reduce) {
  .iw-btn, .iw-row, .iw-group-head { transition: none; }
}
.iw-body { display: flex; flex: 1; min-height: 0; }
/* 左栏自己不滚。检索和标题筛选钉在顶部，下面的树才滚。 */
.iw-tree {
  width: 320px;
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border-right: 0.5px solid var(--dsw-alias-border-l1);
  background: var(--dsw-specific-sidebar-fill);
}
.iw-tree-pin {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
}
.iw-tree-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}
.iw-section { margin-bottom: 12px; }
.iw-section-title {
  padding: 4px 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.iw-section-count {
  margin-left: 6px;
  color: var(--dsw-alias-label-secondary);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}
.iw-group { display: flex; flex-direction: column; gap: 2px; }
.iw-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 6px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease;
}
.iw-group-head:hover { background: var(--dsw-alias-interactive-bg-hover); }
.iw-caret { color: var(--dsw-alias-label-secondary); font-size: 10px; width: 10px; }
.iw-count { margin-left: auto; color: var(--dsw-alias-label-secondary); font-weight: 400; font-variant-numeric: tabular-nums; }
.iw-row {
  display: block;
  width: 100%;
  padding: 4px 8px 4px 16px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease;
}
.iw-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.iw-row-selected {
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent);
  box-shadow: inset 2px 0 0 var(--dsw-alias-label-primary);
}
/* One fixed line per card: 1,137 of them are a list to scan, not a paragraph to
   read, so the row height stays constant and the title truncates. */
.iw-row-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 16px;
  min-height: 30px;
}
.iw-row-line .iw-row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.iw-row-line .iw-row-meta {
  flex: none;
  max-width: 60%;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.iw-row-title { display: block; }
.iw-row-meta { display: block; margin-top: 2px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.iw-row-flat { padding-left: 8px; }
.iw-empty { padding: 16px; color: var(--dsw-alias-label-secondary); font-size: 12px; text-align: center; }
/* 检索进行中不是空列表：左对齐、主色、虚线框，不穿 .iw-empty 的居中灰字。 */
.iw-searching {
  margin: 0 0 8px;
  padding: 8px 10px;
  border: 0.5px dashed var(--dsw-alias-border-l2);
  border-radius: 8px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.5;
  text-align: left;
}
/* The retrieval-degradation notice is a warning about the answer, not an empty
   list, so it does not wear the empty state's clothes. */
.iw-notice {
  margin: 6px 0;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-state-warn-primary);
  border-radius: 8px;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 1.6;
}
.iw-confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 40em;
  margin: 4px 0 8px;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
}
.iw-confirm-ask { color: var(--dsw-alias-label-primary); }
/* 阅读器的确认条把问句放在上面、按钮行右对齐，窄栏才不会把两个动作挤进问句。
   左树的「全部确认」仍是单行，不用这个修饰类。 */
.iw-confirm-stack { flex-direction: column; align-items: stretch; }
.iw-confirm-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.iw-read {
  flex: 1;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 16px 24px 40px;
}
.iw-read-title { font: var(--dsw-font-markdown-h1); margin: 0 0 6px; max-width: 40em; }
.iw-meta { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 14px; max-width: 40em; }
.iw-facts { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 10px 0 14px; font-size: 12px; line-height: 1.4; }
.iw-fact-key { color: var(--dsw-alias-label-secondary); }
.iw-fact-value { overflow-wrap: anywhere; }
.iw-hint { color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.6; }
.iw-error {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 8px 12px;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-state-error-primary);
  border-radius: 8px;
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
}
.iw-error-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
/* Prose keeps a readable measure; tables and code break out of it. */
.iw-md { font: var(--dsw-font-markdown-base); }
.iw-md-h1, .iw-md-h2, .iw-md-h3, .iw-md-p, .iw-md-list, .iw-md-quote { max-width: 40em; }
.iw-md-h1 { font: var(--dsw-font-markdown-h2); margin: 24px 0 8px; }
.iw-md-h2 { font: var(--dsw-font-markdown-h4); margin: 20px 0 6px; }
/* h3 及更深仍是同一档：字号与次级色不动，只把字重和间距抬一点，方便扫读。 */
.iw-md-h3 { margin: 20px 0 6px; font-size: 13px; line-height: 22px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.iw-md-p { margin: 8px 0; }
.iw-md-list { margin: 8px 0; padding-left: 20px; }
.iw-md-list li { margin: 3px 0; }
/* A statute card's body is one quote block, so a quote reads as content. */
.iw-md-quote {
  margin: 10px 0;
  padding: 8px 12px;
  border-left: 3px solid var(--dsw-alias-border-l2);
  border-radius: 0 8px 8px 0;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent);
  color: var(--dsw-alias-label-primary);
}
.iw-md-pre {
  margin: 10px 0;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent);
  overflow-x: auto;
  font: var(--dsw-font-markdown-code);
}
.iw-md-tablewrap { overflow-x: auto; margin: 10px 0; }
.iw-md-table { border-collapse: collapse; width: auto; min-width: 100%; font: var(--dsw-font-markdown-table); }
.iw-md-table th, .iw-md-table td {
  border: 0.5px solid var(--dsw-alias-border-l1);
  padding: 4px 8px;
  text-align: left;
  vertical-align: top;
}
.iw-md-table th {
  font: var(--dsw-font-markdown-table-head);
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);
}
.iw-md a {
  color: var(--dsw-alias-link);
  font-weight: 500;
  text-decoration: none;
}
.iw-md a:hover, .iw-md a:focus-visible { text-decoration: underline dotted; text-underline-offset: 3px; }
/* Everything clickable looks clickable, and nothing that is not clickable does. */
.iw-wikilink-open {
  padding: 0 2px;
  border: 0;
  background: none;
  color: var(--dsw-alias-link);
  font: inherit;
  font-weight: 500;
  text-decoration: underline dotted;
  text-underline-offset: 3px;
  cursor: pointer;
}
.iw-toc,
.iw-related {
  max-width: 40em;
  margin: 10px 0 14px;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
}
.iw-toc summary { cursor: pointer; }
.iw-toc-list {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  margin-top: 2px;
}
.iw-toc-item {
  padding: 2px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.iw-toc-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.iw-toc-item[data-level='2'] { padding-left: 16px; color: var(--dsw-alias-label-secondary); }
.iw-toc-item[data-level='3'], .iw-toc-item[data-level='4'], .iw-toc-item[data-level='5'], .iw-toc-item[data-level='6'] {
  padding-left: 26px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}
.iw-read-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  max-width: 40em;
  margin: 0 0 6px;
}
.iw-read-actions .iw-read-title { flex: 1; min-width: 0; margin: 0; }
.iw-read-actions .iw-btn { flex: none; }
.iw-details { max-width: 40em; margin: 0 0 14px; font-size: 12px; }
.iw-details summary { padding: 2px 0; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.iw-details .iw-facts { margin: 8px 0 0; }
.iw-related-list { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.iw-related-unresolved { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; }
.iw-filter { display: flex; align-items: center; gap: 6px; padding: 0; }
.iw-filter-input {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
}
.iw-filter-input:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.iw-filter-input:disabled { opacity: 0.55; }
.iw-filter-unavailable {
  flex: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
}
.iw-finding-group-head { font-size: 12px; font-weight: 500; }
.iw-tier-head[data-tier='critical'] { box-shadow: inset 2px 0 0 var(--dsw-alias-state-error-primary); }
.iw-tier-head[data-tier='warning'] { box-shadow: inset 2px 0 0 var(--dsw-alias-state-warn-primary); }
.iw-tier-head[data-tier='suggestion'] { box-shadow: inset 2px 0 0 var(--dsw-alias-border-l2); }
.iw-code {
  padding: 0 4px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);
  font-family: var(--ds-font-family-code);
  font-size: 12px;
}
.iw-wikilink {
  display: inline-block;
  padding: 0 4px;
  margin: 0 1px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.iw-search {
  display: flex;
  gap: 6px;
  padding: 0;
}
.iw-input {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}
.iw-actions {
  display: flex;
  gap: 8px;
  margin: 10px 0 4px;
}
.iw-diff {
  margin: 6px 0;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent);
  overflow-x: auto;
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  line-height: 1.6;
  font-variant-numeric: tabular-nums;
}
.iw-finding {
  display: block;
  padding: 5px 8px;
  border-left: 2px solid var(--dsw-alias-border-l1);
  margin: 3px 0;
  font-size: 12px;
  line-height: 1.6;
}
.iw-tier-critical { border-left-color: var(--dsw-alias-state-error-primary); }
.iw-tier-warning { border-left-color: var(--dsw-alias-state-warn-primary); }
/* The suggestion tier is the bulk of a large library's findings, and
   state-idle is 1.47:1 on white, so the tier takes a visible neutral instead. */
.iw-tier-suggestion { border-left-color: var(--dsw-alias-border-l2); }
.iw-finding-head { display: block; font-weight: 500; font-variant-numeric: tabular-nums; }
.iw-finding-path { display: block; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.iw-finding-message { display: block; }
.iw-diff-same { color: var(--dsw-alias-label-secondary); }
/* The diff is the only thing a reviewer reads before confirming, and success
   green is 2.28:1 on white: the sign in the row carries the direction, so the
   hue moves to the row's wash and the text stays on ink. */
.iw-diff-added {
  color: var(--dsw-alias-label-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);
}
.iw-diff-removed {
  color: var(--dsw-alias-label-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);
}
/* 命中卡不借用树行：边框和填充把它从 30px 扫描行里分开。 */
.iw-hit {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 6px 0;
  padding: 8px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent);
}
.iw-hit:hover { background: var(--dsw-alias-interactive-bg-hover); }
.iw-hit[data-selected='true'] {
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent);
  box-shadow: inset 2px 0 0 var(--dsw-alias-label-primary);
}
.iw-hit-open {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.iw-hit-head { display: flex; align-items: baseline; gap: 8px; }
.iw-hit-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
}
.iw-hit-score {
  flex: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.iw-hit-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--dsw-alias-label-primary);
  font-size: 11px;
}
.iw-hit-status::before {
  content: '';
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  corner-shape: round;
  background: var(--dsw-alias-border-l2);
}
.iw-hit-status[data-status='draft']::before,
.iw-hit-status[data-status='deprecated']::before { background: var(--dsw-alias-state-warn-primary); }
.iw-hit-status[data-status='confirmed']::before { background: var(--dsw-alias-state-success-primary); }
.iw-hit-layers { display: flex; flex-direction: column; gap: 1px; }
.iw-hit-type { font-size: 12px; font-weight: 500; line-height: 1.4; }
.iw-hit-domain {
  padding-left: 12px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 1.4;
}
.iw-hit-matched { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.4; }
.iw-hit-snippet {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.iw-hit-source { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.5; }
.iw-hit-source summary { cursor: pointer; }
.iw-hit-source-body { display: block; margin-top: 2px; overflow-wrap: anywhere; }
`
}
