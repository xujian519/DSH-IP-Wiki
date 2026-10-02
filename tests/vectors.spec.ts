/** The vector cache: what it packs, what it refuses, and what it does with a broken file. */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { packVector, readVectorCache, unpackVector, writeVectorCache } from '../src/host/vectors'

/** Directories created by the running test, removed afterwards. */
const created: string[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map(async root => { await rm(root, { recursive: true, force: true }) }))
})

/** A throwaway directory, removed after the test.
 * @returns its path.
 */
async function directory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ip-wiki-vectors-'))
  created.push(root)
  return root
}

describe('packVector and unpackVector', () => {
  it('carries a vector through the packed form unchanged', () => {
    const vector = [0.5, -1.25, 2, 0]
    expect(unpackVector(packVector(vector))).toEqual(vector)
  })

  it('answers back with what float32 can hold, which is what the endpoint sent', () => {
    // The endpoint answers in float32; the packed form keeps exactly that, so a value
    // float32 cannot represent comes back as its nearest float32 rather than as itself.
    const back = unpackVector(packVector([0.1]))?.[0] ?? 0
    expect(back).not.toBe(0.1)
    expect(Math.abs(back - 0.1)).toBeLessThan(1e-7)
  })

  it('refuses text that is not a whole number of floats', () => {
    expect(unpackVector('')).toBeUndefined()
    // Two bytes decode from this, which is not a float32.
    expect(unpackVector('abc')).toBeUndefined()
  })
})

describe('readVectorCache', () => {
  it('reads back what was written', async () => {
    const file = join(await directory(), 'nested', 'vectors.json')
    await writeVectorCache(file, new Map([['cards/rule/a.md|abc', [1, 0]]]))
    expect(await readVectorCache(file)).toEqual(new Map([['cards/rule/a.md|abc', [1, 0]]]))
  })

  it('treats an absent file as an empty cache', async () => {
    expect(await readVectorCache(join(await directory(), 'vectors.json'))).toEqual(new Map())
  })

  it('treats a file that is not JSON as an empty cache', async () => {
    const file = join(await directory(), 'vectors.json')
    await writeFile(file, 'not json at all')
    expect(await readVectorCache(file)).toEqual(new Map())
  })

  it('treats JSON that is not an object as an empty cache', async () => {
    const file = join(await directory(), 'vectors.json')
    for (const payload of ['[1, 2]', 'null', '"text"', '{}']) {
      await writeFile(file, payload)
      expect(await readVectorCache(file)).toEqual(new Map())
    }
  })

  it('keeps the entries it can read and drops the rest', async () => {
    const file = join(await directory(), 'vectors.json')
    await writeFile(file, JSON.stringify({
      good: packVector([1, 1]),
      // A number is not a packed vector, and this text is not a whole number of floats.
      number: 7,
      short: 'abc',
    }))
    expect(await readVectorCache(file)).toEqual(new Map([['good', [1, 1]]]))
  })
})

describe('writeVectorCache', () => {
  it('writes the whole cache rather than patching it', async () => {
    const file = join(await directory(), 'vectors.json')
    await writeVectorCache(file, new Map([['gone', [1]]]))
    await writeVectorCache(file, new Map([['here', [2]]]))
    expect(await readVectorCache(file)).toEqual(new Map([['here', [2]]]))
  })

  it('leaves no half-written file behind', async () => {
    const root = await directory()
    const file = join(root, 'vectors.json')
    await writeVectorCache(file, new Map([['a', [1]]]))
    // The rename target is the only file: the temporary the write went through is gone.
    expect(await readdir(root)).toEqual(['vectors.json'])
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ a: packVector([1]) })
  })
})
