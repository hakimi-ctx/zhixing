import { z } from 'zod'
import { HttpError, json, readBody, route } from '@/lib/server/http'
import { formatCitation } from '@/lib/server/literature'
import { createEntry } from '@/lib/server/vault'
import type { LiteratureWork } from '@/lib/shared/types'

export const dynamic = 'force-dynamic'

const workSchema = z.object({
  id: z.string().min(1).max(300),
  title: z.string().min(1).max(500),
  authors: z.array(z.string().max(200)).max(20),
  year: z.number().int().nullable(),
  venue: z.string().max(300),
  citedBy: z.number().int().nonnegative(),
  doi: z.string().max(200).nullable(),
  url: z.string().max(1000).nullable(),
  oaUrl: z.string().max(1000).nullable(),
  abstract: z.string().max(5000),
  type: z.string().max(80),
  language: z.string().max(40).nullable(),
})

function safeName(title: string, year: number | null): string {
  const base = title.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '未命名文献'
  const y = year ? String(year) : '年未知'
  return `${y}-${base}`
}

export const POST = route(async (req) => {
  const work = (await readBody(req, workSchema)) as LiteratureWork
  const citation = formatCitation(work)
  const lines = [
    `# ${work.title}`,
    '',
    `- 作者：${work.authors.join('、') || '未知'}`,
    `- 年份：${work.year ?? '未知'}`,
    `- 期刊/来源：${work.venue || '未知'}`,
    `- 被引：${work.citedBy}`,
    work.doi ? `- DOI：https://doi.org/${work.doi}` : '',
    work.url ? `- 链接：${work.url}` : '',
    work.oaUrl ? `- 开放获取：${work.oaUrl}` : '',
    '',
    '## 摘要',
    '',
    work.abstract || '（暂无摘要）',
    '',
    '## 引用',
    '',
    citation,
    '',
    '> 由知行「找文献」保存，可在文库中继续整理。',
    '',
  ].filter((line, index, arr) => !(line === '' && arr[index - 1] === ''))

  try {
    await createEntry('', '待读文献', 'dir')
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 409) throw error
  }
  const entry = await createEntry('待读文献', safeName(work.title, work.year), 'note', lines.join('\n'))
  return json({ path: entry.path }, 201)
})
