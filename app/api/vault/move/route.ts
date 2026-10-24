import { z } from 'zod'
import { json, readBody, route } from '@/lib/server/http'
import { remapLibraryPaths } from '@/lib/server/library'
import { moveEntry, normalizeRel, vaultRoot } from '@/lib/server/vault'

export const dynamic = 'force-dynamic'

const schema = z.object({ path: z.string().min(1).max(1000), toDir: z.string().max(1000) })

export const POST = route(async (req) => {
  const body = await readBody(req, schema)
  const result = await moveEntry(body.path, body.toDir)
  await remapLibraryPaths(await vaultRoot(), normalizeRel(body.path), result.path)
  return json(result)
})
