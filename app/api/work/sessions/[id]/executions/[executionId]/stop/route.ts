import { json, route } from '@/lib/server/http'
import { stopExecution } from '@/lib/server/work-exec'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string; executionId: string }> }

export const POST = route(async (_req, ctx: Ctx) => {
  const { id, executionId } = await ctx.params
  return json({ ok: stopExecution(id, executionId) })
})
