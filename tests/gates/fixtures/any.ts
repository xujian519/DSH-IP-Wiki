/** A deliberate `any`, to prove the type-aware lint rules are load-bearing. */
/**
 * Return its argument unchanged.
 * @param value - any value.
 * @returns the same value.
 */
export function identity(value: any): any {
  return value
}
