/**
 * The sidebar's entry icon for the library panel.
 *
 * The sidebar owns the button, its label, and its selected state; this component
 * draws the glyph at the edge the sidebar asks for. The mark is a card and a page
 * side by side, which is what the panel shows.
 * @module dsh-ip-wiki/client/IpWikiIcon
 */
import type { ReactNode } from 'react'

/** The icon share the sidebar hands its entries. */
export interface PanelIconProps {
  /** Requested square edge in pixels. */
  readonly size: number
  /** Whether this panel is the selected one. */
  readonly active?: boolean
}

/**
 * Render the library glyph.
 * @param props - the requested edge and selection state.
 * @returns the icon element.
 */
export function IpWikiIcon({ size }: PanelIconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="1.75" y="2.25" width="4.6" height="11.5" rx="1" />
      <path d="M8.6 2.25h5.65v11.5H8.6z" />
      <path d="M10.1 5.1h2.65M10.1 7.4h2.65M10.1 9.7h1.7M3 5.1h2.1M3 7.4h2.1" />
    </svg>
  )
}
