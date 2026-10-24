import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isValidId, listJsonFiles, readJson, withLock, writeFileAtomic } from './store'

interface Cached<S> {
  mtimeMs: number
  summary: S
}

/**
 * A folder of `<id>.json` records. Summaries are cached by file mtime so listing
 * stays cheap even when individual records (long chats, work logs) get large.
 */
export class JsonCollection<T extends { id: string }, S> {
  private cache = new Map<string, Cached<S>>()

  constructor(
    private dir: () => string,
    private summarize: (record: T) => S,
  ) {}

  private file(id: string): string {
    if (!isValidId(id)) throw new Error('无效的 ID')
    return path.join(this.dir(), `${id}.json`)
  }

  async get(id: string): Promise<T | null> {
    if (!isValidId(id)) return null
    return readJson<T>(this.file(id))
  }

  async save(record: T): Promise<void> {
    const file = this.file(record.id)
    await withLock(file, () => writeFileAtomic(file, JSON.stringify(record, null, 2)))
  }

  /** Read-modify-write under the record's lock. Returns null if the record does not exist. */
  async update(id: string, mutate: (record: T) => T | void): Promise<T | null> {
    if (!isValidId(id)) return null
    const file = this.file(id)
    return withLock(file, async () => {
      const current = await readJson<T>(file)
      if (!current) return null
      const next = mutate(current) ?? current
      await writeFileAtomic(file, JSON.stringify(next, null, 2))
      return next
    })
  }

  async remove(id: string): Promise<void> {
    if (!isValidId(id)) return
    const file = this.file(id)
    await withLock(file, () => fs.rm(file, { force: true }))
    this.cache.delete(id)
  }

  async list(): Promise<S[]> {
    const files = await listJsonFiles(this.dir())
    const seen = new Set<string>()
    const summaries: S[] = []
    await Promise.all(
      files.map(async (file) => {
        const id = path.basename(file, '.json')
        if (!isValidId(id)) return
        const stat = await fs.stat(file).catch(() => null)
        if (!stat) return
        seen.add(id)
        const cached = this.cache.get(id)
        if (cached && cached.mtimeMs === stat.mtimeMs) {
          summaries.push(cached.summary)
          return
        }
        const record = await readJson<T>(file).catch(() => null)
        if (!record || record.id !== id) return
        const summary = this.summarize(record)
        this.cache.set(id, { mtimeMs: stat.mtimeMs, summary })
        summaries.push(summary)
      }),
    )
    for (const id of this.cache.keys()) if (!seen.has(id)) this.cache.delete(id)
    return summaries
  }
}
