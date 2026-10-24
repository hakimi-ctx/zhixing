import type { LibraryInsights, Paper, PaperField, RelationType, UploadResult } from '@/lib/shared/types'
import { api, ApiError } from './api'

export function paperHref(id: string, page?: number | null): string {
  return page ? `/study/paper/${id}?page=${page}` : `/study/paper/${id}`
}

/** The paper a /study/paper/<id> address shows, or null for any other address. */
export function paperIdOf(href: string): string | null {
  const match = href.match(/^\/study\/paper\/([0-9a-f]{24})(?:[?#]|$)/)
  return match ? match[1] : null
}

/** Matches a paper against a filter typed by the student (every word must appear somewhere). */
export function paperMatches(paper: Paper, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const haystack = [paper.title, paper.authors.join(' '), paper.venue, paper.year ?? '', paper.topic, paper.tags.join(' '), paper.card?.keywords.join(' ') ?? '']
    .join(' ')
    .toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

export interface TopicGroup {
  name: string
  description: string
  papers: Paper[]
}

export const UNSORTED_TOPIC = '未归类'

/** Papers grouped by the topics of the last "AI 整理", in the AI's order; null before the first one. */
export function groupByTopic(papers: Paper[], insights: LibraryInsights | null): TopicGroup[] | null {
  if (!insights?.topics.length) return null
  const groups = insights.topics.map((topic) => ({ name: topic.name, description: topic.description, papers: [] as Paper[] }))
  const byName = new Map(groups.map((group) => [group.name, group]))
  const unsorted: TopicGroup = { name: UNSORTED_TOPIC, description: '', papers: [] }
  for (const paper of papers) (byName.get(paper.topic) ?? unsorted).papers.push(paper)
  return [...groups, unsorted].filter((group) => group.papers.length > 0)
}

export type PaperSort = 'added' | 'year' | 'title'

export function sortPapers(papers: Paper[], sort: PaperSort): Paper[] {
  const list = [...papers]
  if (sort === 'year') list.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || b.addedAt - a.addedAt)
  else if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
  else list.sort((a, b) => b.addedAt - a.addedAt)
  return list
}

export interface PaperPatch {
  title?: string
  authors?: string[]
  year?: number | null
  venue?: string
  tags?: string[]
}

/** Multipart uploads must carry this header; the server rejects them otherwise (CSRF guard). */
const UPLOAD_HEADER = 'X-Zhixing-Upload'

async function uploadBatch(files: File[]): Promise<UploadResult> {
  const form = new FormData()
  for (const file of files) form.append('files', file, file.name)
  let response: Response
  try {
    response = await fetch('/api/library/upload', { method: 'POST', body: form, headers: { [UPLOAD_HEADER]: '1' }, cache: 'no-store' })
  } catch {
    throw new ApiError('连不上知行的本地服务。请确认启动窗口还开着。', 0)
  }
  const data = (await response.json().catch(() => null)) as (UploadResult & { error?: string }) | null
  if (!response.ok || !data) throw new ApiError(data?.error ?? `导入失败（${response.status}）`, response.status)
  return data
}

const BATCH_FILES = 10
const BATCH_BYTES = 150 * 1024 * 1024

export const libraryApi = {
  /** Sends PDFs in small batches so a big selection never has to sit in memory all at once. */
  async upload(files: File[]): Promise<UploadResult> {
    const result: UploadResult = { added: [], duplicates: [], rejected: [] }
    let batch: File[] = []
    let bytes = 0
    const flush = async () => {
      if (!batch.length) return
      const part = await uploadBatch(batch)
      result.added.push(...part.added)
      result.duplicates.push(...part.duplicates)
      result.rejected.push(...part.rejected)
      batch = []
      bytes = 0
    }
    for (const file of files) {
      if (batch.length && (batch.length >= BATCH_FILES || bytes + file.size > BATCH_BYTES)) await flush()
      batch.push(file)
      bytes += file.size
    }
    await flush()
    return result
  },
  edit: (id: string, patch: PaperPatch) => api<Paper>(`/api/library/papers/${id}`, { method: 'PATCH', body: patch }),
  remove: (id: string) => api<{ ok: true }>(`/api/library/papers/${id}`, { method: 'DELETE' }),
  retry: (ids?: string[]) => api<{ count: number }>('/api/library/retry', { method: 'POST', body: ids ? { ids } : {} }),
  organize: () => api<{ ok: true }>('/api/library/organize', { method: 'POST' }),
  /** The paper's own mind map or note; created next to the PDF the first time. */
  openFile: (id: string, kind: 'mindmap' | 'note') =>
    api<{ path: string }>(`/api/library/papers/${id}/file`, { method: 'POST', body: { kind } }),
}

export const isPdfFile = (file: File) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf'

export const RELATION_LABEL: Record<RelationType, string> = {
  extends: '延伸',
  compares: '对比',
  contradicts: '观点相左',
  method: '同类方法',
  data: '同一数据',
  related: '相关',
}

export type PaperTone = 'busy' | 'muted' | 'danger'

/** Short state shown on a paper while it is not fully catalogued; null once it is. */
export function paperStatus(paper: Paper): { label: string; tone: PaperTone } | null {
  if (paper.state === 'queued') return { label: '排队中', tone: 'muted' }
  if (paper.state === 'extracting') return { label: '读取中', tone: 'busy' }
  if (paper.state === 'analyzing') return { label: 'AI 建档中', tone: 'busy' }
  if (paper.state === 'failed') return { label: '读取失败', tone: 'danger' }
  if (paper.aiState === 'pending') return { label: '等待建档', tone: 'busy' }
  if (paper.aiState === 'waiting') return { label: '待接入 AI', tone: 'muted' }
  if (paper.aiState === 'failed') return { label: '建档失败', tone: 'danger' }
  return null
}

export const isPaperBusy = (paper: Paper) => paper.state === 'extracting' || paper.state === 'analyzing'

export function authorsShort(authors: string[]): string {
  if (authors.length === 0) return ''
  if (authors.length <= 2) return authors.join('、')
  return `${authors[0]} 等`
}

export function paperMeta(paper: Paper): string {
  return [authorsShort(paper.authors), paper.year ? String(paper.year) : '', paper.venue].filter(Boolean).join(' · ')
}

/** Catalogued papers that the last "AI 整理" has not seen yet. */
export function unorganizedCount(papers: Paper[], insights: LibraryInsights | null): number {
  const seen = new Set(insights?.paperIds ?? [])
  return papers.filter((paper) => paper.card && !seen.has(paper.id)).length
}

export const canOrganize = (papers: Paper[]) => papers.filter((paper) => paper.card).length >= 2

/** The overview cites papers as [P3]; turn those into links to the paper pages. */
export function linkOverview(insights: LibraryInsights, papers: Paper[]): string {
  const titles = new Map(papers.map((paper) => [paper.id, paper.title]))
  return insights.overview.replace(/\[(P(\d+))\]/g, (match, _code: string, digits: string) => {
    const id = insights.paperIds[Number(digits) - 1]
    const title = id ? titles.get(id) : undefined
    if (!id || !title) return match
    const safe = title.replace(/[[\]]/g, '')
    return `[《${safe}》](${paperHref(id)})`
  })
}

export const EDITABLE_FIELDS: readonly PaperField[] = ['title', 'authors', 'year', 'venue', 'tags']

export function splitList(raw: string): string[] {
  return raw
    .split(/[,，;；、\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}
