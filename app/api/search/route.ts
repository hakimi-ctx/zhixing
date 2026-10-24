import { json, route } from '@/lib/server/http'
import { searchVault } from '@/lib/server/search'
import { vaultRoot } from '@/lib/server/vault'
import type { SearchResponse } from '@/lib/shared/types'

export const dynamic = 'force-dynamic'

export const GET = route(async (req) => {
  const query = (new URL(req.url).searchParams.get('q') ?? '').slice(0, 200)
  const response: SearchResponse = { query, hits: query.trim() ? await searchVault(await vaultRoot(), query) : [] }
  return json(response)
})
