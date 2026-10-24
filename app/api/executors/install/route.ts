import { z } from 'zod'
import { openExecutorInstall } from '@/lib/server/executors'
import { json, readBody, route } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

const schema = z.object({ id: z.enum(['workbuddy', 'deepseek-harness']) })

export const POST = route(async (req) => {
  const { id } = await readBody(req, schema)
  await openExecutorInstall(id)
  return json({ ok: true })
})
