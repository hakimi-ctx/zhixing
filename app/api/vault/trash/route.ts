import { z } from 'zod'
import { json, readBody, route } from '@/lib/server/http'
import { remapLibraryPaths } from '@/lib/server/library'
import { normalizeRel, trashEntry, vaultRoot } from '@/lib/server/vault'

export const dynamic = 'force-dynamic'

const schema = z.object({ path: z.string().min(1).max(1000) })

export const POST = route(async (req) => {
  const body = await readBody(req, schema)
  await trashEntry(body.path)
  await remapLibraryPaths(await vaultRoot(), normalizeRel(body.path), null)
  return json({ ok: true })
})
