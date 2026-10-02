/**
 * A line-level difference between two card texts.
 *
 * The panel shows a draft beside what the card says today, so the difference has
 * to be exact rather than approximate: this trims the lines both texts share at
 * the head and at the tail, then reports the changed middle as one removed run
 * followed by one added run. For the case this exists for — a draft that appends a
 * section or rewrites one — that is the whole truth, and it stays linear in the
 * number of lines instead of building a quadratic table.
 * @module dsh-ip-wiki/shared/diff
 */

/** One line of a difference. */
export interface DiffLine {
  /** Whether the line is unchanged, added, or removed. */
  readonly kind: 'same' | 'added' | 'removed'
  /** The line's text, without its newline. */
  readonly text: string
}

/** Split text into lines, dropping the empty tail a trailing newline produces. */
function linesOf(text: string): string[] {
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Compare two texts line by line.
 * @param before - the text the card says today, or empty text for a new card.
 * @param after - the text the draft proposes.
 * @returns the difference, in reading order: the shared head, the removed lines,
 * the added lines, then the shared tail.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const left = linesOf(before)
  const right = linesOf(after)
  let head = 0
  while (head < left.length && head < right.length && left[head] === right[head]) head += 1
  let leftEnd = left.length
  let rightEnd = right.length
  while (leftEnd > head && rightEnd > head && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd -= 1
    rightEnd -= 1
  }
  const diff: DiffLine[] = []
  for (const line of left.slice(0, head)) diff.push({ kind: 'same', text: line })
  for (const line of left.slice(head, leftEnd)) diff.push({ kind: 'removed', text: line })
  for (const line of right.slice(head, rightEnd)) diff.push({ kind: 'added', text: line })
  for (const line of left.slice(leftEnd)) diff.push({ kind: 'same', text: line })
  return diff
}

/**
 * Summarize a difference.
 * @param diff - the difference.
 * @returns how many lines were added and removed.
 */
export function diffCounts(diff: readonly DiffLine[]): { readonly added: number; readonly removed: number } {
  let added = 0
  let removed = 0
  for (const line of diff) {
    if (line.kind === 'added') added += 1
    if (line.kind === 'removed') removed += 1
  }
  return { added, removed }
}
