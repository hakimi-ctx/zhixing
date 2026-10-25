import { z } from 'zod'
import { json, readBody, route } from '@/lib/server/http'
import { testConnection } from '@/lib/server/llm'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const schema = z.object({
  provider: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, '找不到这个模型槽位。'),
})

export const POST = route(async (req) => {
  const { provider } = await readBody(req, schema)
  return json(await testConnection(provider))
})
