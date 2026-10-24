import { z } from 'zod'
import { json, readBody, route } from '@/lib/server/http'
import { createEntry } from '@/lib/server/vault'

export const dynamic = 'force-dynamic'

const schema = z.object({
  parent: z.string().max(1000),
  name: z.string().min(1).max(200),
  kind: z.enum(['dir', 'note', 'mindmap']),
  content: z.string().max(5_000_000).optional(),
})

export const POST = route(async (req) => {
  const body = await readBody(req, schema)
  return json(await createEntry(body.parent, body.name, body.kind, body.content), 201)
})
