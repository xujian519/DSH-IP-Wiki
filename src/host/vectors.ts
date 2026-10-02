/**
 * The vector cache, kept outside the library.
 *
 * Embedding the whole corpus takes about 110 s on the real 1,155-card library, and a
 * start that has to pay it makes every semantic search useless until it finishes. The
 * cache is therefore written to disk and reused across process starts. Two rules shape
 * it:
 *
 * - **Outside the library.** The library stays portable and carries no derived file, so
 *   the cache sits beside the local key file under `~/.dsh/ip-wiki/` and is keyed by the
 *   same content key retrieval uses (path plus a digest of the text). A key that no
 *   longer matches a card is simply never looked up, and saving writes only the keys the
 *   corpus still has.
 * - **float32, base64.** The endpoint answers in float32 and the JSON form prints each
 *   of those numbers with seventeen decimals — 24 MB for the real 1,155-card library,
 *   against 6.4 MB here, for no gain in fidelity.
 *
 * A cache that cannot be read is treated as absent: it is derived data, writes are
 * atomic, and re-embedding is the correct recovery with nothing for a caller to do.
 * @module dsh-ip-wiki/host/vectors
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/** Bytes one float32 takes. */
const FLOAT_BYTES = 4

/**
 * Where the cache lives by default: beside the local key file under the plugin's own
 * directory, never inside a library. A service derives its path from the configured key
 * file, so this is the home a deployment lands on without configuring anything.
 */
export const CACHE_FILE = join(homedir(), '.dsh', 'ip-wiki', 'vectors.json')

/**
 * Encode one vector as little-endian float32 in base64.
 * @param vector - the numbers the endpoint answered with.
 * @returns the packed text.
 */
export function packVector(vector: readonly number[]): string {
  const floats = new Float32Array(vector)
  const bytes = Buffer.alloc(floats.length * FLOAT_BYTES)
  floats.forEach((value, index) => { bytes.writeFloatLE(value, index * FLOAT_BYTES) })
  return bytes.toString('base64')
}

/**
 * Read one vector back.
 * @param text - the packed text.
 * @returns the numbers, or `undefined` when the text is not a whole number of floats.
 */
export function unpackVector(text: string): number[] | undefined {
  const bytes = Buffer.from(text, 'base64')
  if (bytes.length === 0 || bytes.length % FLOAT_BYTES !== 0) return undefined
  const vector: number[] = []
  for (let offset = 0; offset < bytes.length; offset += FLOAT_BYTES) {
    vector.push(bytes.readFloatLE(offset))
  }
  return vector
}

/**
 * Load the cache.
 * @param file - the cache file.
 * @returns the vectors by content key; an absent, unreadable, or malformed file yields
 * an empty map, because the only correct response to a broken cache is to rebuild it.
 */
export async function readVectorCache(file: string): Promise<Map<string, number[]>> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return new Map()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return new Map()
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return new Map()
  const vectors = new Map<string, number[]>()
  for (const [key, packed] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof packed !== 'string') continue
    const vector = unpackVector(packed)
    if (vector !== undefined) vectors.set(key, vector)
  }
  return vectors
}

/**
 * Write the cache, atomically.
 *
 * A half-written cache is worse than no cache, so the text lands in a sibling file
 * first and is renamed over the target, which is atomic on the platforms this runs on.
 * @param file - the cache file.
 * @param vectors - the vectors by content key; this is the whole cache, not a patch.
 */
export async function writeVectorCache(file: string, vectors: ReadonlyMap<string, number[]>): Promise<void> {
  const payload: Record<string, string> = {}
  for (const [key, vector] of vectors) payload[key] = packVector(vector)
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  await writeFile(temporary, JSON.stringify(payload), 'utf8')
  await rename(temporary, file)
}
