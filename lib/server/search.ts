import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import { displayName, mindmapToMarkdown, sanitizeMindmap } from '@/lib/shared/mindmap'
import type { SearchHit } from '@/lib/shared/types'
import { readIndex } from './library'
import { searchPassages, snippetFor } from './retrieval'
import { kindOf } from './vault'

const MAX_FILES = 3000
const MAX_FILE_BYTES = 2 * 1024 * 1024

interface TextFile {
  rel: string
  abs: string
  kind: 'note' | 'mindmap'
}

async function listTextFiles(root: string): Promise<TextFile[]> {
  const files: TextFile[] = []
  const walk = async (absDir: string, relDir: string, depth: number) => {
    if (files.length >= MAX_FILES || depth > 12) return
    const entries = await fs.readdir(absDir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const abs = path.join(absDir, entry.name)
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(abs, rel, depth + 1)
      else if (entry.isFile()) {
        const kind = kindOf(entry.name)
        if (kind === 'note' || kind === 'mindmap') files.push({ rel, abs, kind })
      }
      if (files.length >= MAX_FILES) return
    }
  }
  await walk(root, '', 0)
  return files
}

async function readSearchable(file: TextFile): Promise<string | null> {
  const stat = await fs.stat(file.abs).catch(() => null)
  if (!stat || stat.size > MAX_FILE_BYTES) return null
  const raw = await fs.readFile(file.abs, 'utf8').catch(() => null)
  if (raw === null) return null
  if (file.kind === 'note') return raw
  try {
    const data = sanitizeMindmap(JSON.parse(raw))
    return data ? mindmapToMarkdown(data) : null
  } catch {
    return null
  }
}

/** Every whitespace-separated term must appear (case-insensitive), like Obsidian's default search. */
function matchesAll(haystack: string, terms: string[]): boolean {
  const lower = haystack.toLowerCase()
  return terms.every((term) => lower.includes(term))
}

export async function searchVault(root: string, query: string): Promise<SearchHit[]> {
  const trimmed = query.trim().slice(0, 200)
  if (!trimmed) return []
  const terms = trimmed.toLowerCase().split(/\s+/).filter(Boolean)
  const hits: SearchHit[] = []

  const library = await readIndex(root)
  const titleHits = library.papers.filter((paper) =>
    matchesAll([paper.title, paper.authors.join(' '), paper.tags.join(' '), paper.card?.keywords.join(' ') ?? ''].join(' '), terms),
  )
  for (const paper of titleHits.slice(0, 20)) {
    hits.push({ kind: 'paper', path: paper.path, paperId: paper.id, title: paper.title, page: null, snippet: paper.card?.summary ?? '' })
  }
  const passages = await searchPassages(root, trimmed, { limit: 24, perPaper: 3 })
  for (const passage of passages) {
    const paper = library.papers.find((item) => item.id === passage.paperId)
    if (!paper) continue
    hits.push({
      kind: 'paper',
      path: paper.path,
      paperId: paper.id,
      title: paper.title,
      page: passage.page,
      snippet: snippetFor(passage.text, trimmed),
    })
  }

  let fileHits = 0
  for (const file of await listTextFiles(root)) {
    if (fileHits >= 40) break
    const name = displayName(path.posix.basename(file.rel))
    const content = await readSearchable(file)
    if (content === null) continue
    if (!matchesAll(`${name}\n${content}`, terms)) continue
    fileHits += 1
    hits.push({ kind: file.kind, path: file.rel, title: name, snippet: snippetFor(content, trimmed) })
  }
  return hits
}
