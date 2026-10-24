import { z } from 'zod'
import { json, route } from '@/lib/server/http'
import { searchLiterature } from '@/lib/server/literature'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  q: z.string().max(200).default(''),
  fromYear: z.coerce.number().int().min(1900).max(2100).optional(),
  toYear: z.coerce.number().int().min(1900).max(2100).optional(),
  page: z.coerce.number().int().min(1).max(20).optional(),
})

export const GET = route(async (req) => {
  const raw = Object.fromEntries(new URL(req.url).searchParams.entries())
  const parsed = querySchema.safeParse(raw)
  if (!parsed.success) return json({ error: '参数无效' }, 400)
  const { q, fromYear, toYear, page } = parsed.data
  return json(await searchLiterature({ query: q, fromYear, toYear, page }))
})
