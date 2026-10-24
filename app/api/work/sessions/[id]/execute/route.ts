import { z } from 'zod'
import { json, readBody, route } from '@/lib/server/http'
import { previewExecution, startExecution, writeHandoff } from '@/lib/server/work-exec'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const schema = z.object({
  executorId: z.enum(['workbuddy', 'deepseek-harness']).optional(),
  note: z.string().max(10_000).optional(),
  /** true = only return the exact command for the user to approve. */
  preview: z.boolean().optional(),
  /** true = only write HANDOFF.md, for running the executor by hand. */
  handoffOnly: z.boolean().optional(),
})

export const POST = route(async (req, ctx: Ctx) => {
  const { id } = await ctx.params
  const body = await readBody(req, schema)
  if (body.handoffOnly) return json(await writeHandoff(id, body.note ?? ''))
  const executorId = body.executorId ?? 'workbuddy'
  if (body.preview) return json(await previewExecution(id, executorId))
  const record = await startExecution(id, executorId, body.note ?? '')
  return json(record, 201)
})
