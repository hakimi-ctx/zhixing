import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { singleton } from './singleton'

const locks = singleton('locks', () => new Map<string, Promise<unknown>>())

/** Serialises async work per key (e.g. per file) so concurrent writers never interleave. */
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(fn)
  const tail = next.catch(() => undefined)
  locks.set(key, tail)
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key)
  })
  return next
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Write to a temp file and rename it into place. On Windows the rename can fail
 * briefly while antivirus or the indexer holds the file, so retry before falling
 * back to a direct write.
 */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID().slice(0, 8)}.tmp`
  await fs.writeFile(temp, data, typeof data === 'string' ? 'utf8' : undefined)
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(temp, file)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if ((code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') && attempt < 5) {
        await sleep(60 * (attempt + 1))
        continue
      }
      try {
        await fs.writeFile(file, data, typeof data === 'string' ? 'utf8' : undefined)
      } finally {
        await fs.rm(temp, { force: true })
      }
      return
    }
  }
}

export async function readJson<T>(file: string): Promise<T | null> {
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, '')) as T
  } catch {
    const backup = `${file}.corrupt-${Date.now()}`
    await fs.rename(file, backup).catch(() => undefined)
    console.error(`[zhixing] ${file} was not valid JSON; moved it to ${backup}`)
    return null
  }
}

export function writeJson(file: string, value: unknown): Promise<void> {
  return withLock(file, () => writeFileAtomic(file, JSON.stringify(value, null, 2)))
}

export async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => path.join(dir, entry.name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id)
}

export function newId(): string {
  return randomUUID()
}
