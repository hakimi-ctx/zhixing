import { z } from 'zod'
import { json, readBody, route } from '@/lib/server/http'
import { testConnection } from '@/lib/server/llm'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const schema = z.object({ provider: z.enum(['chatgpt', 'claude', 'gemini']) })

export const POST = route(async (req) => {
  const { provider } = await readBody(req, schema)
  return json(await testConnection(provider))
})
