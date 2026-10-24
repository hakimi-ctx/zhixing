import 'server-only'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { MINDMAP_EXT, emptyMindmap } from '@/lib/shared/mindmap'
import type {
  LibraryInsights,
  LibraryTopic,
  Paper,
  PaperCard,
  PaperField,
  PaperRelation,
  PaperState,
  RelationType,
} from '@/lib/shared/types'
import { HttpError } from './http'
import { hashFile } from './pdf-text'
import { singleton } from './singleton'
import { readJson, withLock, writeFileAtomic } from './store'

/** Uploaded PDFs go here (inside the vault). */
export const PAPERS_DIR = '论文'
/** Library data lives inside the vault, like Obsidian's .obsidian folder, so it moves with the vault. */
const META_DIR = '.zhixing'
export const MAX_PDF_BYTES = 200 * 1024 * 1024
const MAX_SCAN_FILES = 5000
const MAX_SCAN_DEPTH = 12
const SKIPPED_DIRS = new Set(['node_modules'])

interface FileStamp {
  size: number
  mtimeMs: number
  id: string
}

export interface LibraryIndex {
  version: 1
  papers: Paper[]
  insights: LibraryInsights | null
  /** Vault-relative PDF path → hash, so unchanged files are not hashed again on every scan. */
  stamps: Record<string, FileStamp>
}

export interface PaperText {
  pages: string[]
}

const metaDir = (root: string) => path.join(root, META_DIR)
const indexFile = (root: string) => path.join(metaDir(root), 'library.json')
const textFile = (root: string, id: string) => path.join(metaDir(root), 'text', `${id}.json`)

const PAPER_ID = /^[0-9a-f]{24}$/
export const isPaperId = (id: string) => PAPER_ID.test(id)

const versions = singleton('library-versions', () => new Map<string, number>())

/** Changes whenever the index is written; the search index uses it to know when to rebuild. */
export function libraryVersion(root: string): number {
  return versions.get(root) ?? 0
}

/* ---------- Normalisation ---------- */

const STATES: readonly PaperState[] = ['queued', 'extracting', 'analyzing', 'ready', 'failed']
const AI_STATES = ['waiting', 'pending', 'done', 'failed'] as const
const FIELDS: readonly PaperField[] = ['title', 'authors', 'year', 'venue', 'tags']
export const RELATION_TYPES: readonly RelationType[] = ['extends', 'compares', 'contradicts', 'method', 'data', 'related']

type Loose = Record<string, unknown>
const asObject = (value: unknown): Loose => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : {})
const text = (value: unknown, max = 2000) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const textList = (value: unknown, maxItems: number, maxLength: number) =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
            .map((item) => item.trim().slice(0, maxLength)),
        ),
      ).slice(0, maxItems)
    : []
const relPath = (value: unknown) => (typeof value === 'string' && value && !value.includes('..') && !value.startsWith('/') ? value : null)

export function normalizeYear(value: unknown): number | null {
  const year = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value.match(/\d{4}/)?.[0] ?? '', 10) : NaN
  return Number.isInteger(year) && year >= 1800 && year <= 2200 ? year : null
}

export function normalizeCard(raw: unknown): PaperCard | null {
  if (!raw || typeof raw !== 'object') return null
  const value = asObject(raw)
  const card: PaperCard = {
    summary: text(value.summary, 600),
    problem: text(value.problem, 2000),
    method: text(value.method, 2000),
    findings: text(value.findings, 2000),
    limitations: text(value.limitations, 2000),
    keywords: textList(value.keywords, 12, 60),
  }
  return card.summary || card.problem || card.method || card.findings ? card : null
}

function normalizePaper(raw: unknown): Paper | null {
  const value = asObject(raw)
  const id = text(value.id, 40)
  const filePath = relPath(value.path)
  if (!isPaperId(id) || !filePath) return null
  const state = STATES.includes(value.state as PaperState) ? (value.state as PaperState) : 'queued'
  const aiState = AI_STATES.includes(value.aiState as (typeof AI_STATES)[number]) ? (value.aiState as Paper['aiState']) : 'pending'
  const paper: Paper = {
    id,
    path: filePath,
    size: typeof value.size === 'number' ? value.size : 0,
    addedAt: typeof value.addedAt === 'number' ? value.addedAt : Date.now(),
    title: text(value.title, 400) || titleFromFile(filePath),
    authors: textList(value.authors, 50, 120),
    year: normalizeYear(value.year),
    venue: text(value.venue, 200),
    tags: textList(value.tags, 30, 40),
    topic: text(value.topic, 60),
    card: normalizeCard(value.card),
    pages: typeof value.pages === 'number' ? value.pages : 0,
    textChars: typeof value.textChars === 'number' ? value.textChars : 0,
    state,
    aiState,
    mindmap: relPath(value.mindmap),
    note: relPath(value.note),
    edited: textList(value.edited, FIELDS.length, 20).filter((field): field is PaperField => FIELDS.includes(field as PaperField)),
  }
  const error = text(value.error, 1000)
  if (error) paper.error = error
  return paper
}

function normalizeInsights(raw: unknown, ids: Set<string>): LibraryInsights | null {
  if (!raw || typeof raw !== 'object') return null
  const value = asObject(raw)
  const topics: LibraryTopic[] = (Array.isArray(value.topics) ? value.topics : [])
    .map(asObject)
    .map((topic) => ({
      name: text(topic.name, 60),
      description: text(topic.description, 400),
      paperIds: textList(topic.paperIds, 1000, 40).filter((id) => ids.has(id)),
    }))
    .filter((topic) => topic.name)
    .slice(0, 20)
  const relations: PaperRelation[] = (Array.isArray(value.relations) ? value.relations : [])
    .map(asObject)
    .map((relation) => ({
      from: text(relation.from, 40),
      to: text(relation.to, 40),
      type: RELATION_TYPES.includes(relation.type as RelationType) ? (relation.type as RelationType) : 'related',
      note: text(relation.note, 300),
    }))
    .filter((relation) => relation.from !== relation.to && ids.has(relation.from) && ids.has(relation.to))
    .slice(0, 600)
  return {
    at: typeof value.at === 'number' ? value.at : Date.now(),
    model: text(value.model, 200),
    paperIds: textList(value.paperIds, 2000, 40),
    topics,
    relations,
    overview: text(value.overview, 60_000),
  }
}

function normalizeIndex(raw: unknown): LibraryIndex {
  const value = asObject(raw)
  const seen = new Set<string>()
  const papers: Paper[] = []
  for (const item of Array.isArray(value.papers) ? value.papers : []) {
    const paper = normalizePaper(item)
    if (!paper || seen.has(paper.id)) continue
    seen.add(paper.id)
    papers.push(paper)
  }
  const stamps: Record<string, FileStamp> = {}
  for (const [key, stamp] of Object.entries(asObject(value.stamps))) {
    const item = asObject(stamp)
    if (relPath(key) && typeof item.size === 'number' && typeof item.mtimeMs === 'number' && isPaperId(text(item.id, 40))) {
      stamps[key] = { size: item.size, mtimeMs: item.mtimeMs, id: text(item.id, 40) }
    }
  }
  return { version: 1, papers, insights: normalizeInsights(value.insights, seen), stamps }
}

/* ---------- Index access ---------- */

export async function readIndex(root: string): Promise<LibraryIndex> {
  return normalizeIndex(await readJson<unknown>(indexFile(root)))
}

/** Read-modify-write under a per-file lock; the file is only rewritten when something changed. */
export function updateIndex<T>(root: string, change: (index: LibraryIndex) => T): Promise<T> {
  const file = indexFile(root)
  return withLock(file, async () => {
    const index = await readIndex(root)
    const before = JSON.stringify(index)
    const result = change(index)
    const after = JSON.stringify(index)
    if (after !== before) {
      await writeFileAtomic(file, after)
      versions.set(root, libraryVersion(root) + 1)
    }
    return result
  })
}

export async function loadPaperText(root: string, id: string): Promise<PaperText | null> {
  if (!isPaperId(id)) return null
  const data = await readJson<{ pages?: unknown }>(textFile(root, id)).catch(() => null)
  if (!data || !Array.isArray(data.pages)) return null
  return { pages: data.pages.map((page) => (typeof page === 'string' ? page : '')) }
}

export async function savePaperText(root: string, id: string, pages: string[]): Promise<void> {
  await writeFileAtomic(textFile(root, id), JSON.stringify({ pages }))
}

async function removePaperText(root: string, id: string): Promise<void> {
  await fs.rm(textFile(root, id), { force: true }).catch(() => undefined)
}

/* ---------- Helpers ---------- */

export function titleFromFile(filePath: string): string {
  const base = path.posix.basename(filePath).replace(/\.pdf$/i, '')
  return base.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || '未命名论文'
}

function newPaper(id: string, filePath: string, size: number): Paper {
  return {
    id,
    path: filePath,
    size,
    addedAt: Date.now(),
    title: titleFromFile(filePath),
    authors: [],
    year: null,
    venue: '',
    tags: [],
    topic: '',
    card: null,
    pages: 0,
    textChars: 0,
    state: 'queued',
    aiState: 'pending',
    mindmap: null,
    note: null,
    edited: [],
  }
}

const within = (target: string, ancestor: string) => target === ancestor || target.startsWith(`${ancestor}/`)
const remap = (target: string, from: string, to: string) => (target === from ? to : `${to}${target.slice(from.length)}`)
const parentRel = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')

async function fileExists(abs: string): Promise<boolean> {
  return fs
    .stat(abs)
    .then((stat) => stat.isFile())
    .catch(() => false)
}

const absOf = (root: string, rel: string) => path.join(root, ...rel.split('/'))

function dropFromInsights(index: LibraryIndex, ids: Set<string>) {
  if (!index.insights || ids.size === 0) return
  index.insights.topics = index.insights.topics
    .map((topic) => ({ ...topic, paperIds: topic.paperIds.filter((id) => !ids.has(id)) }))
    .filter((topic) => topic.paperIds.length > 0)
  index.insights.relations = index.insights.relations.filter((relation) => !ids.has(relation.from) && !ids.has(relation.to))
}

/* ---------- Scanning the vault for PDFs ---------- */

interface PdfFile {
  rel: string
  abs: string
  size: number
  mtimeMs: number
}

async function listPdfs(root: string): Promise<PdfFile[]> {
  const result: PdfFile[] = []
  const walk = async (absDir: string, relDir: string, depth: number) => {
    if (result.length >= MAX_SCAN_FILES || depth > MAX_SCAN_DEPTH) return
    let entries
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (result.length >= MAX_SCAN_FILES) return
      if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name.toLowerCase())) continue
      const abs = path.join(absDir, entry.name)
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(abs, rel, depth + 1)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
        const stat = await fs.stat(abs).catch(() => null)
        if (stat && stat.size > 0 && stat.size <= MAX_PDF_BYTES) result.push({ rel, abs, size: stat.size, mtimeMs: stat.mtimeMs })
      }
    }
  }
  await walk(root, '', 0)
  return result
}

const syncState = singleton('library-sync', () => new Map<string, { at: number; running: Promise<void> | null }>())

/**
 * Reconciles the index with the PDFs on disk: new files are added (and queued), moved or renamed
 * files keep their record (matched by content hash), and records whose file is gone are removed.
 */
export async function syncLibrary(root: string): Promise<void> {
  const files = await listPdfs(root)
  const before = await readIndex(root)
  const hashes = new Map<string, string>()
  for (const file of files) {
    const stamp = before.stamps[file.rel]
    if (stamp && stamp.size === file.size && Math.abs(stamp.mtimeMs - file.mtimeMs) < 2) {
      hashes.set(file.rel, stamp.id)
      continue
    }
    const hash = await hashFile(file.abs).catch(() => null)
    if (hash) hashes.set(file.rel, hash.slice(0, 24))
  }

  const linkChecks = new Map<string, boolean>()
  for (const paper of before.papers) {
    for (const link of [paper.mindmap, paper.note]) {
      if (link && !linkChecks.has(link)) linkChecks.set(link, await fileExists(absOf(root, link)))
    }
  }

  const removed: string[] = []
  await updateIndex(root, (index) => {
    const stamps: Record<string, FileStamp> = {}
    const pathsById = new Map<string, string[]>()
    for (const file of files) {
      const id = hashes.get(file.rel)
      if (!id) continue
      stamps[file.rel] = { size: file.size, mtimeMs: file.mtimeMs, id }
      pathsById.set(id, [...(pathsById.get(id) ?? []), file.rel])
    }
    index.stamps = stamps

    const known = new Set<string>()
    index.papers = index.papers.filter((paper) => {
      const found = pathsById.get(paper.id)
      if (!found) {
        removed.push(paper.id)
        return false
      }
      if (!found.includes(paper.path)) paper.path = found[0]
      known.add(paper.id)
      for (const key of ['mindmap', 'note'] as const) {
        const link = paper[key]
        if (link && linkChecks.get(link) === false) paper[key] = null
      }
      return true
    })
    for (const [id, found] of pathsById) {
      if (known.has(id)) continue
      const stamp = stamps[found[0]]
      index.papers.push(newPaper(id, found[0], stamp.size))
      known.add(id)
    }
    dropFromInsights(index, new Set(removed))
  })
  await Promise.all(removed.map((id) => removePaperText(root, id)))
}

/** Scans at most once every `maxAgeMs` per vault; concurrent callers share the running scan. */
export async function syncIfStale(root: string, maxAgeMs: number): Promise<void> {
  const entry = syncState.get(root) ?? { at: 0, running: null }
  syncState.set(root, entry)
  if (entry.running) return entry.running
  if (Date.now() - entry.at < maxAgeMs) return
  entry.running = syncLibrary(root)
    .catch((error) => console.error('[zhixing] library scan failed:', error))
    .finally(() => {
      entry.at = Date.now()
      entry.running = null
    })
  return entry.running
}

/* ---------- Upload ---------- */

const INVALID_NAME = /[<>:"/\\|?*\u0000-\u001F]/g
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

export function safeFileBase(raw: string, fallback: string): string {
  const base = raw
    .replace(INVALID_NAME, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .slice(0, 100)
    .trim()
  return !base || RESERVED.test(base) ? fallback : base
}

async function uniqueFile(dir: string, base: string, extension: string): Promise<string> {
  for (let index = 1; index < 1000; index++) {
    const name = index === 1 ? `${base}${extension}` : `${base} (${index})${extension}`
    const taken = await fs
      .stat(path.join(dir, name))
      .then(() => true)
      .catch(() => false)
    if (!taken) return name
  }
  throw new HttpError(409, '同名文件太多了，请先整理一下文件夹。')
}

function looksLikePdf(data: Uint8Array): boolean {
  const head = Buffer.from(data.subarray(0, 1024)).toString('latin1')
  return head.includes('%PDF-')
}

export type ImportResult =
  | { status: 'added'; paper: Paper }
  | { status: 'duplicate'; paper: Paper }
  | { status: 'rejected'; reason: string }

export async function importPdf(root: string, originalName: string, data: Uint8Array): Promise<ImportResult> {
  if (data.byteLength === 0) return { status: 'rejected', reason: '文件是空的' }
  if (data.byteLength > MAX_PDF_BYTES) return { status: 'rejected', reason: '超过 200 MB' }
  if (!looksLikePdf(data)) return { status: 'rejected', reason: '不是 PDF 文件' }
  const id = createHash('sha256').update(data).digest('hex').slice(0, 24)
  const existing = (await readIndex(root)).papers.find((paper) => paper.id === id)
  if (existing) return { status: 'duplicate', paper: existing }

  const dir = path.join(root, PAPERS_DIR)
  await fs.mkdir(dir, { recursive: true })
  const base = safeFileBase(path.basename(originalName.replace(/\\/g, '/')).replace(/\.pdf$/i, ''), '未命名论文')
  const fileName = await uniqueFile(dir, base, '.pdf')
  const abs = path.join(dir, fileName)
  await writeFileAtomic(abs, data)
  const stat = await fs.stat(abs)
  const rel = `${PAPERS_DIR}/${fileName}`
  const result = await updateIndex(root, (index): ImportResult => {
    const duplicate = index.papers.find((paper) => paper.id === id)
    if (duplicate) return { status: 'duplicate', paper: duplicate }
    const paper = newPaper(id, rel, stat.size)
    index.papers.push(paper)
    index.stamps[rel] = { size: stat.size, mtimeMs: stat.mtimeMs, id }
    return { status: 'added', paper }
  })
  if (result.status === 'duplicate') await fs.rm(abs, { force: true }).catch(() => undefined)
  return result
}

/* ---------- Editing ---------- */

export interface PaperPatch {
  title?: string
  authors?: string[]
  year?: number | null
  venue?: string
  tags?: string[]
}

export async function editPaper(root: string, id: string, patch: PaperPatch): Promise<Paper> {
  return updateIndex(root, (index) => {
    const paper = index.papers.find((item) => item.id === id)
    if (!paper) throw new HttpError(404, '文库里没有这篇论文。')
    const mark = (field: PaperField) => {
      if (!paper.edited.includes(field)) paper.edited.push(field)
    }
    if (patch.title !== undefined) {
      paper.title = patch.title.trim().slice(0, 400) || titleFromFile(paper.path)
      mark('title')
    }
    if (patch.authors !== undefined) {
      paper.authors = textList(patch.authors, 50, 120)
      mark('authors')
    }
    if (patch.year !== undefined) {
      paper.year = normalizeYear(patch.year)
      mark('year')
    }
    if (patch.venue !== undefined) {
      paper.venue = patch.venue.trim().slice(0, 200)
      mark('venue')
    }
    if (patch.tags !== undefined) {
      paper.tags = textList(patch.tags, 30, 40)
      mark('tags')
    }
    return paper
  })
}

/** Re-queues papers: failed extractions are re-read, everything else is catalogued again. */
export async function requeuePapers(root: string, ids: string[] | null): Promise<number> {
  return updateIndex(root, (index) => {
    let count = 0
    for (const paper of index.papers) {
      const targeted = ids ? ids.includes(paper.id) : paper.state === 'failed' || paper.aiState === 'failed'
      if (!targeted || paper.state === 'extracting' || paper.state === 'analyzing') continue
      if (paper.state === 'failed' || paper.state === 'queued') paper.state = 'queued'
      else paper.state = 'ready'
      paper.aiState = 'pending'
      delete paper.error
      count += 1
    }
    return count
  })
}

/** Removes a paper record (the caller moves the PDF to the trash first). */
export async function forgetPaper(root: string, id: string): Promise<void> {
  await updateIndex(root, (index) => {
    const paper = index.papers.find((item) => item.id === id)
    if (!paper) return
    index.papers = index.papers.filter((item) => item.id !== id)
    for (const [key, stamp] of Object.entries(index.stamps)) if (stamp.id === id) delete index.stamps[key]
    dropFromInsights(index, new Set([id]))
  })
  await removePaperText(root, id)
}

/**
 * Keeps paper records in step with renames, moves and deletions made inside 知行.
 * `to === null` means the entry was moved to the trash.
 */
export async function remapLibraryPaths(root: string, from: string, to: string | null): Promise<void> {
  const removed: string[] = []
  await updateIndex(root, (index) => {
    index.papers = index.papers.filter((paper) => {
      if (within(paper.path, from)) {
        if (!to) {
          removed.push(paper.id)
          return false
        }
        paper.path = remap(paper.path, from, to)
      }
      for (const key of ['mindmap', 'note'] as const) {
        const link = paper[key]
        if (link && within(link, from)) paper[key] = to ? remap(link, from, to) : null
      }
      return true
    })
    const stamps: Record<string, FileStamp> = {}
    for (const [key, stamp] of Object.entries(index.stamps)) {
      if (!within(key, from)) stamps[key] = stamp
      else if (to) stamps[remap(key, from, to)] = stamp
    }
    index.stamps = stamps
    dropFromInsights(index, new Set(removed))
  })
  await Promise.all(removed.map((id) => removePaperText(root, id)))
}

/* ---------- Mind maps and notes that belong to a paper ---------- */

function shortTitle(paper: Paper): string {
  const title = paper.title.replace(/\s+/g, ' ').trim()
  return title.length > 60 ? `${title.slice(0, 60).trim()}…` : title
}

const paperFileRuns = singleton('paper-file-runs', () => new Map<string, Promise<string>>())

/**
 * Returns the paper's mind map (or note), creating it next to the PDF the first time.
 * The student builds the map; it starts with only the paper title as the central topic.
 * Concurrent calls for the same file share one run, so a double click cannot create two files.
 */
export function ensurePaperFile(root: string, id: string, kind: 'mindmap' | 'note'): Promise<string> {
  const key = `${root}\n${id}\n${kind}`
  const running = paperFileRuns.get(key)
  if (running) return running
  const run = createPaperFile(root, id, kind).finally(() => paperFileRuns.delete(key))
  paperFileRuns.set(key, run)
  return run
}

async function createPaperFile(root: string, id: string, kind: 'mindmap' | 'note'): Promise<string> {
  const paper = (await readIndex(root)).papers.find((item) => item.id === id)
  if (!paper) throw new HttpError(404, '文库里没有这篇论文。')
  const linked = kind === 'mindmap' ? paper.mindmap : paper.note
  if (linked && (await fileExists(absOf(root, linked)))) return linked

  const dirRel = parentRel(paper.path)
  const dirAbs = dirRel ? absOf(root, dirRel) : root
  const base = safeFileBase(shortTitle(paper).replace(/…$/, ''), titleFromFile(paper.path))
  const extension = kind === 'mindmap' ? MINDMAP_EXT : '.md'
  const fileName = await uniqueFile(dirAbs, base, extension)
  const rel = dirRel ? `${dirRel}/${fileName}` : fileName
  const content =
    kind === 'mindmap'
      ? JSON.stringify({ ...emptyMindmap(shortTitle(paper)), paperId: paper.id }, null, 2)
      : `# ${paper.title}\n\n> 论文：${path.posix.basename(paper.path)}\n\n`
  await fs.writeFile(absOf(root, rel), content, { encoding: 'utf8', flag: 'wx' })
  await updateIndex(root, (index) => {
    const target = index.papers.find((item) => item.id === id)
    if (target) target[kind] = rel
  })
  return rel
}

export function pendingCount(papers: Paper[]): number {
  return papers.filter(
    (paper) =>
      paper.state === 'queued' ||
      paper.state === 'extracting' ||
      paper.state === 'analyzing' ||
      (paper.state === 'ready' && paper.aiState === 'pending'),
  ).length
}

export function paperAbs(root: string, paper: Paper): string {
  return absOf(root, paper.path)
}
