import { z } from 'zod'
import { HttpError, json, readBody, route } from '@/lib/server/http'
import { RelaySetupError, listModels } from '@/lib/server/llm'

export const dynamic = 'force-dynamic'

const schema = z.object({
  baseUrl: z.string().trim().max(500).optional(),
  apiKey: z.string().trim().max(1000).optional(),
  provider: z.enum(['chatgpt', 'claude', 'gemini']).optional(),
})

/** POST so unsaved form values (including a freshly typed key) never end up in a URL. */
export const POST = route(async (req) => {
  const body = await readBody(req, schema)
  try {
    return json({ models: await listModels(body) })
  } catch (error) {
    if (error instanceof RelaySetupError) throw new HttpError(400, error.message)
    throw error
  }
})
