/** A deliberate unawaited promise, to prove the type-aware lint rules are load-bearing. */
/** Resolve on the next microtask. */
export async function later(): Promise<void> {
  await Promise.resolve()
}

/** Start work and drop the promise. */
export function fireAndForget(): void {
  later()
}
