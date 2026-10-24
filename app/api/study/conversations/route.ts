import { conversations } from '@/lib/server/conversations'
import { json, route } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

export const GET = route(async () => {
  const list = await conversations.list()
  return json(list.sort((a, b) => b.updatedAt - a.updatedAt))
})
