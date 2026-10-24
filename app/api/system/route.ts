import { json, route } from '@/lib/server/http'
import { systemInfo } from '@/lib/server/system'

export const dynamic = 'force-dynamic'

export const GET = route(async () => json(await systemInfo()))
