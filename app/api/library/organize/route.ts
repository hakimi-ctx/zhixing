import { json, route } from '@/lib/server/http'
import { startOrganize } from '@/lib/server/library-worker'

export const dynamic = 'force-dynamic'

export const POST = route(async () => {
  await startOrganize()
  return json({ ok: true })
})
