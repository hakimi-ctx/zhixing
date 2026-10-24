import { z } from 'zod'
import { activeChatFor } from '@/lib/server/chat-runs'
import { conversations } from '@/lib/server/conversations'
import { HttpError, json, readBody, route } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export const GET = route(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params
  const conversation = await conversations.get(id)
  if (!conversation) throw new HttpError(404, '找不到这个对话，可能已经被删除。')
  return json({ ...conversation, running: Boolean(activeChatFor(id)) })
})

const patchSchema = z.object({ title: z.string().trim().min(1, '标题不能为空').max(80, '标题最多 80 个字') })

export const PATCH = route(async (req, ctx: Ctx) => {
  const { id } = await ctx.params
  const { title } = await readBody(req, patchSchema)
  const updated = await conversations.update(id, (conversation) => {
    conversation.title = title
  })
  if (!updated) throw new HttpError(404, '找不到这个对话。')
  return json({ ok: true })
})

export const DELETE = route(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params
  if (activeChatFor(id)) throw new HttpError(409, '导师正在回答这个对话，请先停止再删除。')
  await conversations.remove(id)
  return json({ ok: true })
})
