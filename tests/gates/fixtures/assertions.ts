/** A deliberate non-null assertion, to prove the type-aware lint rules are load-bearing. */
/**
 * Trim a maybe-absent string.
 * @param value - the value to trim.
 * @returns the trimmed value.
 */
export function trimmed(value: string | null): string {
  return value!.trim()
}
