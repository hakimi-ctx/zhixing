import { json, route } from '@/lib/server/http'
import { listTree } from '@/lib/server/vault'

export const dynamic = 'force-dynamic'

export const GET = route(async () => json(await listTree()))
