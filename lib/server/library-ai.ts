import 'server-only'
import { PROVIDER_IDS, type AppConfig, type LibraryInsights, type Paper, type PaperCard, type ProviderId } from '@/lib/shared/types'
import { providerReady } from './config'
import { extractJsonObject } from './json-extract'
import { normalizeCard, normalizeYear, RELATION_TYPES } from './library'
import { callModel } from './llm'

/** The tutor's model manages the library; any other ready model is the fallback. */
export function libraryProvider(config: AppConfig): ProviderId | null {
  if (providerReady(config, config.study.provider)) return config.study.provider
  return PROVIDER_IDS.find((id) => providerReady(config, id)) ?? null
}

async function askJson(config: AppConfig, provider: ProviderId, system: string, user: string, timeoutMs: number) {
  const first = await callModel({ provider, config, timeoutMs, request: { system, messages: [{ role: 'user', content: user }] } })
  try {
    return { data: extractJsonObject(first.text), model: first.model }
  } catch {
    const retry = await callModel({
      provider,
      config,
      timeoutMs,
      request: {
        system,
        messages: [
          { role: 'user', content: user },
          { role: 'assistant', content: first.text },
          { role: 'user', content: '请只输出符合要求的 JSON 对象本身，不要任何解释，也不要代码块标记。' },
        ],
      },
    })
    return { data: extractJsonObject(retry.text), model: retry.model }
  }
}

const EXCERPT_HEAD = 14_000
const EXCERPT_TAIL = 5_000
const CONCLUSION = /(^|\n)\s*(\d+(\.\d+)*\.?\s*)?(conclusions?|concluding remarks|summary and conclusions?|discussion|结论|总结|结语|讨论)\s*(\n|$)/i

/** Title, abstract and introduction from the start, plus the conclusion section when it can be found. */
export function paperExcerpt(pages: string[]): string {
  const head: string[] = []
  let used = 0
  for (let index = 0; index < pages.length && used < EXCERPT_HEAD; index++) {
    const page = pages[index].slice(0, EXCERPT_HEAD - used)
    if (!page.trim()) continue
    head.push(`【第 ${index + 1} 页】\n${page}`)
    used += page.length
  }
  const lastHeadPage = head.length
  let tail = ''
  for (let index = pages.length - 1; index >= Math.max(lastHeadPage, Math.floor(pages.length * 0.4)); index--) {
    const match = pages[index].match(CONCLUSION)
    if (match?.index !== undefined) {
      tail = `【第 ${index + 1} 页起】\n${pages.slice(index).join('\n').slice(match.index, match.index + EXCERPT_TAIL)}`
      break
    }
  }
  return [head.join('\n\n'), tail].filter(Boolean).join('\n\n……\n\n')
}

export interface CatalogueResult {
  title: string
  authors: string[]
  year: number | null
  venue: string
  card: PaperCard
  model: string
}

const CATALOGUE_SYSTEM = [
  '你是学术论文编目助手，负责为学生的论文文库建立资料卡。',
  '要求：',
  '1. 只依据给出的正文摘录，不要编造；摘录里找不到的信息留空字符串、空数组或 null。',
  '2. summary：一句话概括论文的核心贡献，不超过 60 个字。',
  '3. problem / method / findings / limitations：各用 1～3 句话写清楚具体内容（研究什么问题、怎么做、得到什么结果、有哪些局限），不写空话套话。',
  '4. keywords：3～8 个关键词，专有名词保留原文。',
  '5. title、authors、venue 保持论文原文；其余字段用简体中文。',
  '6. 只输出一个 JSON 对象：',
  '{"title":"","authors":[],"year":null,"venue":"","summary":"","problem":"","method":"","findings":"","limitations":"","keywords":[]}',
].join('\n')

export async function cataloguePaper(config: AppConfig, provider: ProviderId, paper: Paper, pages: string[]): Promise<CatalogueResult> {
  const user = [`文件名：${paper.path.split('/').pop()}`, `页数：${pages.length}`, '<正文摘录>', paperExcerpt(pages), '</正文摘录>'].join('\n')
  const { data, model } = await askJson(config, provider, CATALOGUE_SYSTEM, user, 240_000)
  const value = (data ?? {}) as Record<string, unknown>
  const card = normalizeCard(value)
  if (!card) throw new Error('模型返回的资料卡是空的。')
  const authors = Array.isArray(value.authors)
    ? value.authors.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim().slice(0, 120)).slice(0, 50)
    : []
  return {
    title: typeof value.title === 'string' ? value.title.replace(/\s+/g, ' ').trim().slice(0, 400) : '',
    authors,
    year: normalizeYear(value.year),
    venue: typeof value.venue === 'string' ? value.venue.trim().slice(0, 200) : '',
    card,
    model,
  }
}

const ORGANIZE_SYSTEM = [
  '你是学生论文文库的管理员。下面是文库里每篇论文的资料卡，论文用 P1、P2… 编号。请完成三件事：',
  '1. topics：按研究主题把论文分成 2～8 组。name 不超过 12 个字，description 用一句话说明这组论文共同研究什么。每篇论文只归入最贴切的一组，所有论文都要归组。',
  '2. relations：找出论文之间有依据的关系。type 只能是 extends（在其基础上改进或扩展）、compares（做了直接比较）、contradicts（结论相互冲突）、method（使用了对方的方法）、data（使用了相同的数据集或基准）、related（研究同一个问题）。note 用一句话说明依据。没有把握的关系不要写。',
  '3. overview：用简体中文写一份文库综述（Markdown，用二级标题分节）：研究脉络、共识与分歧、研究空白与可以做的方向、建议的阅读顺序。提到论文时写编号，例如 [P3]。',
  '只输出一个 JSON 对象：',
  '{"topics":[{"name":"","description":"","papers":["P1"]}],"relations":[{"from":"P1","to":"P2","type":"related","note":""}],"overview":""}',
].join('\n')

function cardLine(paper: Paper, code: string): string {
  const parts = [`${code}《${paper.title}》`]
  const meta = [paper.authors.slice(0, 3).join('、') + (paper.authors.length > 3 ? ' 等' : ''), paper.year ?? '', paper.venue].filter(Boolean)
  if (meta.length) parts.push(`（${meta.join('，')}）`)
  const card = paper.card
  if (card) {
    parts.push(`\n  概要：${card.summary}`)
    if (card.problem) parts.push(`\n  问题：${card.problem}`)
    if (card.method) parts.push(`\n  方法：${card.method}`)
    if (card.findings) parts.push(`\n  结论：${card.findings}`)
    if (card.keywords.length) parts.push(`\n  关键词：${card.keywords.join('，')}`)
  }
  if (paper.tags.length) parts.push(`\n  学生标签：${paper.tags.join('，')}`)
  return parts.join('')
}

export const MAX_ORGANIZE_PAPERS = 200

export async function organizePapers(config: AppConfig, provider: ProviderId, papers: Paper[]): Promise<LibraryInsights> {
  const selected = papers.slice(0, MAX_ORGANIZE_PAPERS)
  const codes = new Map<string, string>()
  selected.forEach((paper, index) => codes.set(`P${index + 1}`, paper.id))
  const user = ['<文库资料卡>', ...selected.map((paper, index) => cardLine(paper, `P${index + 1}`)), '</文库资料卡>'].join('\n')
  const { data, model } = await askJson(config, provider, ORGANIZE_SYSTEM, user, 600_000)
  const value = (data ?? {}) as Record<string, unknown>
  const resolve = (code: unknown) => (typeof code === 'string' ? codes.get(code.trim().replace(/^\[|\]$/g, '').toUpperCase()) : undefined)

  const assigned = new Set<string>()
  const topics = (Array.isArray(value.topics) ? value.topics : [])
    .map((raw) => {
      const topic = (raw ?? {}) as Record<string, unknown>
      const paperIds = (Array.isArray(topic.papers) ? topic.papers : [])
        .map(resolve)
        .filter((id): id is string => Boolean(id) && !assigned.has(id as string))
      paperIds.forEach((id) => assigned.add(id))
      return {
        name: typeof topic.name === 'string' ? topic.name.trim().slice(0, 60) : '',
        description: typeof topic.description === 'string' ? topic.description.trim().slice(0, 400) : '',
        paperIds,
      }
    })
    .filter((topic) => topic.name && topic.paperIds.length)
  const leftovers = selected.map((paper) => paper.id).filter((id) => !assigned.has(id))
  if (leftovers.length) topics.push({ name: '其他', description: '暂未归入以上主题的论文。', paperIds: leftovers })

  const relations = (Array.isArray(value.relations) ? value.relations : [])
    .map((raw) => {
      const relation = (raw ?? {}) as Record<string, unknown>
      const from = resolve(relation.from)
      const to = resolve(relation.to)
      const type = RELATION_TYPES.find((item) => item === relation.type) ?? 'related'
      return from && to && from !== to ? { from, to, type, note: typeof relation.note === 'string' ? relation.note.trim().slice(0, 300) : '' } : null
    })
    .filter((relation): relation is NonNullable<typeof relation> => relation !== null)

  const overview = typeof value.overview === 'string' ? value.overview.trim().slice(0, 60_000) : ''
  if (!topics.length && !overview) throw new Error('模型没有给出整理结果。')
  return { at: Date.now(), model, paperIds: selected.map((paper) => paper.id), topics, relations, overview }
}
