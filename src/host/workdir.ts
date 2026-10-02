/**
 * The plugin's own directory inside the library root.
 *
 * Everything the plugin writes that is not a card lives here: pending drafts, the
 * archive of decided ones, the backups a revert restores, and the audit log. One
 * module owns the layout, so a second writer cannot invent a slightly different
 * path and quietly split the audit trail in two.
 * @module dsh-ip-wiki/host/workdir
 */
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { inside } from './library'

/** Directory the plugin owns inside the library root. */
export const WORK_DIR = '.dsh-ip-wiki'

/** Where pending drafts wait. */
export const DRAFTS_DIR = `${WORK_DIR}/drafts`

/** Where decided drafts are kept for the audit trail. */
export const ARCHIVE_DIR = `${WORK_DIR}/archive`

/** Where replaced files are kept for a revert. */
export const BACKUPS_DIR = `${WORK_DIR}/backups`

/** The append-only audit log. */
export const LOG_FILE = `${WORK_DIR}/log.md`

/** Write one file through a neighbouring temporary file, so a crash leaves one version. */
export async function writeAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.draft-tmp`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(temporary, content)
  await rename(temporary, path)
}

/** Append one audit line. */
export async function logLine(root: string, line: string): Promise<void> {
  const path = inside(root, LOG_FILE)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${new Date().toISOString()} ${line}\n`, { flag: 'a' })
}

/**
 * List one directory's file names.
 * @param dir - the absolute directory to read.
 * @param suffix - only names ending with this are returned.
 * @returns the names, sorted; a missing directory reads as empty.
 */
export async function fileNames(dir: string, suffix: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith(suffix))
    .map(entry => entry.name)
    .sort()
}
