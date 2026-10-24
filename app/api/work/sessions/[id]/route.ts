import { HttpError, json, route } from '@/lib/server/http'
import { deleteSession, loadSession } from '@/lib/server/work-store'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export const GET = route(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params
  const session = await loadSession(id)
  if (!session) throw new HttpError(404, '找不到这个任务，可能已经被删除。')
  return json(session)
})

export const DELETE = route(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params
  await deleteSession(id)
  return json({ ok: true })
})
