import { json, route } from '@/lib/server/http'
import { resumeWorkSession } from '@/lib/server/work-engine'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export const POST = route(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params
  await resumeWorkSession(id)
  return json({ ok: true })
})
