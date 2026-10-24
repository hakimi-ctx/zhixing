import { z } from 'zod'
import { json, readBody, route } from '@/lib/server/http'
import { requeuePapers } from '@/lib/server/library'
import { kickLibraryWorker, resumeCataloguing } from '@/lib/server/library-worker'
import { vaultRoot } from '@/lib/server/vault'

export const dynamic = 'force-dynamic'

const schema = z.object({ ids: z.array(z.string().regex(/^[0-9a-f]{24}$/)).max(2000).optional() })

/** Without ids: retries every failed paper. With ids: re-catalogues exactly those papers. */
export const POST = route(async (req) => {
  const { ids } = await readBody(req, schema)
  const root = await vaultRoot()
  resumeCataloguing(root)
  const count = await requeuePapers(root, ids ?? null)
  kickLibraryWorker()
  return json({ count })
})
