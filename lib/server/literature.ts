import 'server-only'
import type { LiteratureSearchResponse, LiteratureWork } from '@/lib/shared/types'

const OPENALEX = 'https://api.openalex.org/works'
const UA = 'Zhixing/1.0 (mailto:xiaochentingxingde@gmail.com; literature search for student research)'

type OpenAlexWork = {
  id?: string
  display_name?: string
  title?: string
  publication_year?: number | null
  cited_by_count?: number
  doi?: string | null
  type?: string
  language?: string | null
  authorships?: { author?: { display_name?: string } }[]
  primary_location?: {
    landing_page_url?: string | null
    pdf_url?: string | null
    source?: { display_name?: string | null } | null
  } | null
  open_access?: { is_oa?: boolean; oa_url?: string | null } | null
  abstract_inverted_index?: Record<string, number[]> | null
}

function reconstructAbstract(index: Record<string, number[]> | null | undefined): string {
  if (!index) return ''
  const slots: { pos: number; word: string }[] = []
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) slots.push({ pos, word })
  }
  slots.sort((a, b) => a.pos - b.pos)
  const text = slots.map((item) => item.word).join(' ')
  return text.length > 600 ? `${text.slice(0, 597)}…` : text
}

function doiUrl(doi: string | null | undefined): string | null {
  if (!doi) return null
  const clean = doi.replace(/^https?:\/\/doi\.org\//i, '').trim()
  return clean ? `https://doi.org/${clean}` : null
}

function mapWork(raw: OpenAlexWork): LiteratureWork | null {
  const title = (raw.display_name || raw.title || '').trim()
  if (!title) return null
  const doi = raw.doi ? raw.doi.replace(/^https?:\/\/doi\.org\//i, '') : null
  const oaUrl = raw.open_access?.oa_url || raw.primary_location?.pdf_url || null
  const landing = raw.primary_location?.landing_page_url || doiUrl(doi) || raw.id || null
  const authors = (raw.authorships ?? [])
    .map((item) => item.author?.display_name?.trim())
    .filter((name): name is string => Boolean(name))
    .slice(0, 12)
  return {
    id: raw.id || `${title}-${raw.publication_year ?? ''}`,
    title,
    authors,
    year: raw.publication_year ?? null,
    venue: raw.primary_location?.source?.display_name?.trim() || '',
    citedBy: raw.cited_by_count ?? 0,
    doi,
    url: landing,
    oaUrl,
    abstract: reconstructAbstract(raw.abstract_inverted_index),
    type: raw.type || 'article',
    language: raw.language ?? null,
  }
}

export async function searchLiterature(opts: {
  query: string
  fromYear?: number | null
  toYear?: number | null
  page?: number
  perPage?: number
}): Promise<LiteratureSearchResponse> {
  const query = opts.query.trim().slice(0, 200)
  const page = Math.max(1, Math.min(opts.page ?? 1, 20))
  const perPage = Math.max(5, Math.min(opts.perPage ?? 20, 50))
  const fromYear = opts.fromYear ?? null
  const toYear = opts.toYear ?? null

  if (!query) {
    return { query, fromYear, toYear, total: 0, page, perPage, works: [], source: 'openalex' }
  }

  const filters: string[] = ['type:article|review|book-chapter|dissertation']
  if (fromYear) filters.push(`from_publication_date:${fromYear}-01-01`)
  if (toYear) filters.push(`to_publication_date:${toYear}-12-31`)

  const url = new URL(OPENALEX)
  url.searchParams.set('search', query)
  url.searchParams.set('filter', filters.join(','))
  url.searchParams.set('sort', 'relevance_score:desc')
  url.searchParams.set('per_page', String(perPage))
  url.searchParams.set('page', String(page))
  url.searchParams.set(
    'select',
    'id,doi,title,display_name,publication_year,cited_by_count,authorships,primary_location,open_access,abstract_inverted_index,type,language',
  )

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return {
        query,
        fromYear,
        toYear,
        total: 0,
        page,
        perPage,
        works: [],
        source: 'openalex',
        error: `文献库暂时不可用（${response.status}）${text ? `：${text.slice(0, 120)}` : ''}`,
      }
    }
    const data = (await response.json()) as { meta?: { count?: number }; results?: OpenAlexWork[] }
    const works = (data.results ?? []).map(mapWork).filter((item): item is LiteratureWork => Boolean(item))
    return {
      query,
      fromYear,
      toYear,
      total: data.meta?.count ?? works.length,
      page,
      perPage,
      works,
      source: 'openalex',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      query,
      fromYear,
      toYear,
      total: 0,
      page,
      perPage,
      works: [],
      source: 'openalex',
      error: message.includes('abort') ? '检索超时，请稍后再试。' : `检索失败：${message}`,
    }
  } finally {
    clearTimeout(timer)
  }
}

export function formatCitation(work: LiteratureWork): string {
  const authors =
    work.authors.length === 0
      ? '佚名'
      : work.authors.length <= 3
        ? work.authors.join('、')
        : `${work.authors.slice(0, 3).join('、')} 等`
  const year = work.year ? String(work.year) : 'n.d.'
  const venue = work.venue ? `. ${work.venue}` : ''
  const doi = work.doi ? `. https://doi.org/${work.doi}` : work.url ? `. ${work.url}` : ''
  return `${authors}. ${work.title}${venue}, ${year}${doi}`
}
