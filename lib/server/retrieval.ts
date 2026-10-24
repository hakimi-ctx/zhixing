import 'server-only'
import type { Paper } from '@/lib/shared/types'
import { libraryVersion, loadPaperText, readIndex } from './library'
import { singleton } from './singleton'

const CJK_RUN = /[\u3400-\u9fff\uf900-\ufaff]+/g
const LATIN_WORD = /[a-z0-9]+/g
const STOP_WORDS = new Set(
  'the of and to in a is for on with as by we that this are be from an it at or which our can not has have was were these their its also such use using used than then there into been more most may other some what when where who will would how about over under between both each only very via per'.split(
    ' ',
  ),
)

function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

/** Latin words (lower-cased, light stemming) plus Chinese character bigrams. */
export function tokenize(input: string): string[] {
  const lower = input.toLowerCase()
  const tokens: string[] = []
  for (const match of lower.matchAll(LATIN_WORD)) {
    const word = match[0]
    if (word.length < 2 && !/\d/.test(word)) continue
    if (STOP_WORDS.has(word)) continue
    tokens.push(stem(word))
  }
  for (const match of lower.matchAll(CJK_RUN)) {
    const run = match[0]
    if (run.length === 1) tokens.push(run)
    for (let index = 0; index + 1 < run.length; index++) tokens.push(run.slice(index, index + 2))
  }
  return tokens
}

const CHUNK_SIZE = 900
const CHUNK_OVERLAP = 150

/** Splits a page into overlapping passages, preferring sentence and line boundaries. */
export function chunkPage(page: string): string[] {
  const clean = page.trim()
  if (clean.length <= CHUNK_SIZE) return clean ? [clean] : []
  const chunks: string[] = []
  let start = 0
  while (start < clean.length) {
    let end = Math.min(clean.length, start + CHUNK_SIZE)
    if (end < clean.length) {
      const window = clean.slice(start + Math.floor(CHUNK_SIZE * 0.6), end)
      const breakAt = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('。'), window.lastIndexOf('. '), window.lastIndexOf('；'))
      if (breakAt > 0) end = start + Math.floor(CHUNK_SIZE * 0.6) + breakAt + 1
    }
    chunks.push(clean.slice(start, end).trim())
    if (end >= clean.length) break
    start = Math.max(end - CHUNK_OVERLAP, start + 1)
  }
  return chunks.filter(Boolean)
}

interface Passage {
  paperId: string
  page: number
  text: string
  length: number
}

interface SearchIndex {
  version: number
  passages: Passage[]
  /** token → flat [passageIndex, termFrequency, …] */
  postings: Map<string, number[]>
  averageLength: number
  papers: Map<string, Paper>
}

const cache = singleton('library-search-index', () => new Map<string, { index: SearchIndex | null; building: Promise<SearchIndex> | null }>())

async function buildIndex(root: string): Promise<SearchIndex> {
  const version = libraryVersion(root)
  const library = await readIndex(root)
  const passages: Passage[] = []
  const postings = new Map<string, number[]>()
  let totalLength = 0
  const papers = new Map(library.papers.map((paper) => [paper.id, paper]))
  for (const paper of library.papers) {
    if (paper.state !== 'ready' && paper.state !== 'analyzing') continue
    const content = await loadPaperText(root, paper.id)
    if (!content) continue
    const header = [paper.title, paper.card?.keywords.join(' ') ?? ''].join(' ')
    content.pages.forEach((page, pageIndex) => {
      for (const chunk of chunkPage(page)) {
        const tokens = tokenize(pageIndex === 0 ? `${header}\n${chunk}` : chunk)
        if (!tokens.length) continue
        const passageIndex = passages.length
        passages.push({ paperId: paper.id, page: pageIndex + 1, text: chunk, length: tokens.length })
        totalLength += tokens.length
        const counts = new Map<string, number>()
        for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
        for (const [token, count] of counts) {
          const list = postings.get(token)
          if (list) list.push(passageIndex, count)
          else postings.set(token, [passageIndex, count])
        }
      }
    })
  }
  return { version, passages, postings, averageLength: passages.length ? totalLength / passages.length : 1, papers }
}

async function indexFor(root: string): Promise<SearchIndex> {
  const entry = cache.get(root) ?? { index: null, building: null }
  cache.set(root, entry)
  if (entry.index && entry.index.version === libraryVersion(root)) return entry.index
  if (!entry.building) {
    entry.building = buildIndex(root)
      .then((index) => {
        entry.index = index
        return index
      })
      .finally(() => {
        entry.building = null
      })
  }
  return entry.building
}

export interface PassageHit {
  paperId: string
  title: string
  page: number
  text: string
  score: number
}

export interface SearchOptions {
  limit?: number
  perPaper?: number
  /** Only search inside these papers. */
  paperIds?: string[]
}

/** BM25 over page passages. Returns the best passages, at most `perPaper` from any one paper. */
export async function searchPassages(root: string, query: string, options: SearchOptions = {}): Promise<PassageHit[]> {
  const terms = Array.from(new Set(tokenize(query))).slice(0, 64)
  if (!terms.length) return []
  const index = await indexFor(root)
  const total = index.passages.length
  if (!total) return []
  const only = options.paperIds ? new Set(options.paperIds) : null
  const k1 = 1.2
  const b = 0.75
  const scores = new Map<number, number>()
  for (const term of terms) {
    const list = index.postings.get(term)
    if (!list) continue
    const documentFrequency = list.length / 2
    const idf = Math.log(1 + (total - documentFrequency + 0.5) / (documentFrequency + 0.5))
    for (let cursor = 0; cursor < list.length; cursor += 2) {
      const passageIndex = list[cursor]
      const passage = index.passages[passageIndex]
      if (only && !only.has(passage.paperId)) continue
      const frequency = list[cursor + 1]
      const norm = frequency + k1 * (1 - b + (b * passage.length) / index.averageLength)
      scores.set(passageIndex, (scores.get(passageIndex) ?? 0) + idf * ((frequency * (k1 + 1)) / norm))
    }
  }
  const ranked = [...scores.entries()].sort((a, c) => c[1] - a[1])
  const limit = options.limit ?? 8
  const perPaper = options.perPaper ?? 3
  const used = new Map<string, number>()
  const pages = new Set<string>()
  const hits: PassageHit[] = []
  for (const [passageIndex, score] of ranked) {
    const passage = index.passages[passageIndex]
    const count = used.get(passage.paperId) ?? 0
    // Overlapping chunks of one page would otherwise show up as near-duplicate citations.
    const pageKey = `${passage.paperId}:${passage.page}`
    if (count >= perPaper || pages.has(pageKey)) continue
    used.set(passage.paperId, count + 1)
    pages.add(pageKey)
    hits.push({
      paperId: passage.paperId,
      title: index.papers.get(passage.paperId)?.title ?? '',
      page: passage.page,
      text: passage.text,
      score,
    })
    if (hits.length >= limit) break
  }
  return hits
}

/** A short excerpt around the first matching term, for search result lists. */
export function snippetFor(content: string, query: string, size = 160): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  const lower = flat.toLowerCase()
  const needles = [query.trim().toLowerCase(), ...query.toLowerCase().split(/\s+/)].filter((item) => item.length >= 1)
  let at = -1
  for (const needle of needles) {
    at = lower.indexOf(needle)
    if (at >= 0) break
  }
  if (at < 0) {
    for (const token of tokenize(query)) {
      at = lower.indexOf(token)
      if (at >= 0) break
    }
  }
  if (at < 0) return flat.slice(0, size)
  const start = Math.max(0, at - Math.floor(size / 3))
  return `${start > 0 ? '…' : ''}${flat.slice(start, start + size)}${start + size < flat.length ? '…' : ''}`
}
