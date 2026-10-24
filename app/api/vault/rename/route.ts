import { z } from 'zod'
import { json, readBody, route } from '@/lib/server/http'
import { remapLibraryPaths } from '@/lib/server/library'
import { normalizeRel, renameEntry, vaultRoot } from '@/lib/server/vault'

export const dynamic = 'force-dynamic'

const schema = z.object({ path: z.string().min(1).max(1000), name: z.string().min(1).max(200) })

export const POST = route(async (req) => {
  const body = await readBody(req, schema)
  const result = await renameEntry(body.path, body.name)
  await remapLibraryPaths(await vaultRoot(), normalizeRel(body.path), result.path)
  return json(result)
})
