import 'server-only'
import path from 'node:path'
import type { ChatSource, Paper } from '@/lib/shared/types'
import { HttpError } from './http'
import { loadPaperText, readIndex } from './library'
import { searchPassages } from './retrieval'

const CATALOG_LIMIT = 80
const PAPER_PROMPT_CHARS = 150_000

function catalogLine(paper: Paper): string {
  const meta = [paper.year, paper.topic].filter(Boolean).join(' · ')
  return `- 《${paper.title}》${meta ? `（${meta}）` : ''}${paper.card?.summary ? `：${paper.card.summary}` : ''}`
}

export interface LibraryContext {
  reference: string
  sources: ChatSource[]
}

/**
 * The library is the tutor's knowledge base: a catalogue of every paper, the passages that best
 * match the question (numbered for citation), and the latest AI overview of the library.
 */
export async function libraryContext(root: string, query: string): Promise<LibraryContext | null> {
  const index = await readIndex(root)
  const papers = index.papers.filter((paper) => paper.state === 'ready' || paper.state === 'analyzing')
  if (!papers.length) return null
  const hits = await searchPassages(root, query, { limit: 8, perPaper: 3 })
  const sources: ChatSource[] = hits.map((hit, position) => ({ n: position + 1, paperId: hit.paperId, title: hit.title, page: hit.page }))
  const parts = [
    `<文库目录 共 ${papers.length} 篇>`,
    ...papers.slice(0, CATALOG_LIMIT).map(catalogLine),
    papers.length > CATALOG_LIMIT ? `……另有 ${papers.length - CATALOG_LIMIT} 篇没有列出` : '',
    '</文库目录>',
  ]
  if (hits.length) {
    parts.push('<文库检索结果>')
    hits.forEach((hit, position) => parts.push(`[${position + 1}]《${hit.title}》第 ${hit.page} 页\n${hit.text}`))
    parts.push('</文库检索结果>')
  }
  if (index.insights?.overview) {
    const codes = new Map(index.insights.paperIds.map((id, position) => [`P${position + 1}`, id]))
    const titles = new Map(index.papers.map((paper) => [paper.id, paper.title]))
    const overview = index.insights.overview.replace(/\[(P\d+)\]/g, (match, code: string) => {
      const title = titles.get(codes.get(code) ?? '')
      return title ? `《${title}》` : match
    })
    parts.push(`<文库综述>\n${overview.slice(0, 8000)}\n</文库综述>`)
  }
  return { reference: parts.filter(Boolean).join('\n'), sources }
}

/** The full text of an attached paper, with page markers, for questions about one paper. */
export async function paperForPrompt(root: string, rel: string): Promise<{ name: string; text: string; paperId: string }> {
  const index = await readIndex(root)
  const paper = index.papers.find((item) => item.path === rel)
  if (!paper) throw new HttpError(404, '这篇论文不在文库里。')
  const content = await loadPaperText(root, paper.id)
  if (!content) throw new HttpError(409, '这篇论文还没读取完，请稍后再问。')
  let text = ''
  for (let page = 0; page < content.pages.length && text.length < PAPER_PROMPT_CHARS; page++) {
    if (content.pages[page].trim()) text += `【第 ${page + 1} 页】\n${content.pages[page]}\n\n`
  }
  if (text.length > PAPER_PROMPT_CHARS) text = `${text.slice(0, PAPER_PROMPT_CHARS)}\n…（后面的页面没有附上）`
  const header = [`标题：${paper.title}`, paper.authors.length ? `作者：${paper.authors.join('、')}` : '', paper.year ? `年份：${paper.year}` : '']
    .filter(Boolean)
    .join('\n')
  return { name: path.posix.basename(rel), text: `${header}\n\n${text.trim()}`, paperId: paper.id }
}
