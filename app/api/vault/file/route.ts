import { z } from 'zod'
import { HttpError, json, readBody, route } from '@/lib/server/http'
import { readVaultFile, writeVaultFile } from '@/lib/server/vault'

export const dynamic = 'force-dynamic'

export const GET = route(async (req) => {
  const target = new URL(req.url).searchParams.get('path')
  if (!target) throw new HttpError(400, '缺少文件路径。')
  return json(await readVaultFile(target))
})

const writeSchema = z.object({
  path: z.string().min(1).max(1000),
  content: z.string(),
  baseMtimeMs: z.number().optional(),
  force: z.boolean().optional(),
})

export const PUT = route(async (req) => {
  const body = await readBody(req, writeSchema)
  const result = await writeVaultFile(body.path, body.content, body.baseMtimeMs, body.force ?? false)
  return json(result, result.ok ? 200 : 409)
})
