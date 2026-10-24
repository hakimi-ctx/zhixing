import { z } from 'zod'
import { stopChat } from '@/lib/server/chat-runs'
import { json, readBody, route } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

const schema = z.object({ runId: z.string().min(1).max(64) })

export const POST = route(async (req) => {
  const { runId } = await readBody(req, schema)
  return json({ ok: stopChat(runId) })
})
