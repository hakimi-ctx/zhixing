import { configPatchSchema, loadConfig, maskConfig, updateConfig } from '@/lib/server/config'
import { json, readBody, route } from '@/lib/server/http'
import { kickLibraryWorker, resumeCataloguing } from '@/lib/server/library-worker'

export const dynamic = 'force-dynamic'

export const GET = route(async () => json(maskConfig(await loadConfig())))

export const PATCH = route(async (req) => {
  const patch = await readBody(req, configPatchSchema)
  const next = await updateConfig(patch)
  // A new key, model or vault may unblock papers that were waiting for the relay.
  resumeCataloguing()
  kickLibraryWorker()
  return json(maskConfig(next))
})
