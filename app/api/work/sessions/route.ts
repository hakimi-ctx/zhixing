import { z } from 'zod'
import { json, readBody, route } from '@/lib/server/http'
import { createWorkSession } from '@/lib/server/work-engine'
import { listSessions } from '@/lib/server/work-store'

export const dynamic = 'force-dynamic'

export const GET = route(async () => json(await listSessions()))

const createSchema = z.object({
  task: z.string().trim().min(4, '请把任务描述得具体一点（至少 4 个字）。').max(20_000, '任务描述最多 2 万字。'),
})

export const POST = route(async (req) => {
  const { task } = await readBody(req, createSchema)
  const session = await createWorkSession(task)
  return json({ id: session.id }, 201)
})
