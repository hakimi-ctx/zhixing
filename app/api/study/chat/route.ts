import { z } from 'zod'
import { activeChatFor, finishChat, registerChat } from '@/lib/server/chat-runs'
import { loadConfig } from '@/lib/server/config'
import { conversations, titleFrom } from '@/lib/server/conversations'
import { HttpError, errorMessage, readBody, route } from '@/lib/server/http'
import { callModel, isAbortError, type ModelRequest } from '@/lib/server/llm'
import { newId } from '@/lib/server/store'
import { buildTutorRequest, chooseSkill } from '@/lib/server/tutor'
import { PROVIDER_META } from '@/lib/shared/providers'
import type { ChatMessage, ChatMessageMeta, ChatSource, ChatStreamEvent, Conversation, ProviderId } from '@/lib/shared/types'

export const dynamic = 'force-dynamic'

const schema = z.object({
  runId: z.string().min(8).max(64),
  conversationId: z.string().max(64).optional(),
  message: z.string().max(200_000).optional(),
  regenerate: z.boolean().optional(),
  provider: z.enum(['chatgpt', 'claude', 'gemini']),
  skill: z.string().max(64),
  attachment: z.string().max(1000).nullable().optional(),
  /** Use the paper library as the tutor's knowledge base (default on). */
  library: z.boolean().optional(),
})

function withoutTrailingReplies(messages: ChatMessage[]): ChatMessage[] {
  let end = messages.length
  while (end > 0 && messages[end - 1].role === 'assistant') end -= 1
  return messages.slice(0, end)
}

async function appendReply(conversationId: string, message: ChatMessage, skill: string | null): Promise<boolean> {
  const updated = await conversations.update(conversationId, (conversation) => {
    conversation.messages.push(message)
    conversation.updatedAt = message.createdAt
    if (skill) conversation.lastSkill = skill
  })
  return updated !== null
}

/**
 * Streams one tutor reply as NDJSON. The model call is tied to the run (not the HTTP request),
 * so closing the page does not lose the answer: it is still saved to the conversation.
 */
export const POST = route(async (req) => {
  const body = await readBody(req, schema)
  const regenerate = body.regenerate ?? false
  const text = body.message?.trim() ?? ''
  if (!regenerate && !text) throw new HttpError(400, '消息不能为空。')
  if (regenerate && !body.conversationId) throw new HttpError(400, '重新回答需要指定对话。')

  const provider: ProviderId = body.provider
  const config = await loadConfig()
  // Mentor can use study.model/apiKey/baseUrl (e.g. Sonnet) while Work keeps providers.claude as Opus.
  if (config.study.model || config.study.apiKey || config.study.baseUrl) {
    if (provider === config.study.provider) {
      if (config.study.model) config.providers[provider] = { ...config.providers[provider], model: config.study.model }
      if (config.study.baseUrl) config.providers[provider] = { ...config.providers[provider], baseUrl: config.study.baseUrl }
      if (config.study.apiKey) config.providers[provider] = { ...config.providers[provider], apiKey: config.study.apiKey }
    }
  }
  if (!config.providers[provider].enabled) {
    throw new HttpError(400, `${PROVIDER_META[provider].label} 已在设置里停用，请换一个模型。`)
  }

  const now = Date.now()
  let conversation: Conversation
  if (body.conversationId) {
    const existing = await conversations.get(body.conversationId)
    if (!existing) throw new HttpError(404, '找不到这个对话，可能已经被删除。')
    conversation = existing
  } else {
    conversation = { id: newId(), title: titleFrom(text), createdAt: now, updatedAt: now, lastSkill: null, messages: [] }
  }

  let userMessage: ChatMessage
  if (regenerate) {
    conversation.messages = withoutTrailingReplies(conversation.messages)
    const last = conversation.messages[conversation.messages.length - 1]
    if (!last) throw new HttpError(400, '这个对话里没有可以重新回答的问题。')
    userMessage = last
  } else {
    userMessage = {
      id: newId(),
      role: 'user',
      content: text,
      createdAt: now,
      meta: body.attachment ? { attachment: body.attachment } : undefined,
    }
    conversation.messages.push(userMessage)
  }

  const skill = chooseSkill(body.skill, userMessage.content, conversation.lastSkill)
  let request: ModelRequest
  let sources: ChatSource[] = []
  try {
    const built = await buildTutorRequest({
      history: conversation.messages,
      skill,
      currentAttachment: regenerate ? null : (body.attachment ?? null),
      useLibrary: body.library !== false,
    })
    request = built.request
    sources = built.sources
  } catch (error) {
    throw new HttpError(400, `读取附件失败：${errorMessage(error)}`)
  }

  if (activeChatFor(conversation.id)) throw new HttpError(409, '导师还在回答这个对话的上一条消息，请等它完成或先停止。')
  const controller = new AbortController()
  registerChat({ runId: body.runId, conversationId: conversation.id, controller, startedAt: now })

  try {
    if (body.conversationId) {
      const saved = await conversations.update(conversation.id, (current) => {
        if (regenerate) current.messages = withoutTrailingReplies(current.messages)
        else current.messages.push(userMessage)
        current.updatedAt = now
      })
      if (!saved) throw new HttpError(404, '找不到这个对话，可能已经被删除。')
      conversation = saved
    } else {
      await conversations.save(conversation)
    }
  } catch (error) {
    finishChat(body.runId)
    throw error
  }

  const encoder = new TextEncoder()
  // Assigned synchronously by the ReadableStream constructor.
  let sink!: ReadableStreamDefaultController<Uint8Array>
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      sink = streamController
    },
    cancel() {
      closed = true
    },
  })
  const send = (event: ChatStreamEvent) => {
    if (closed) return
    try {
      sink.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
    } catch {
      closed = true
    }
  }

  const conversationId = conversation.id
  const title = conversation.title
  void (async () => {
    const startedAt = Date.now()
    const ping = setInterval(() => send({ type: 'ping' }), 10_000)
    let partial = ''
    const baseMeta = (): ChatMessageMeta => ({ provider, skill, durationMs: Date.now() - startedAt })
    send({ type: 'start', conversationId, title, userMessage, skill })
    send({ type: 'status', text: `正在请 ${PROVIDER_META[provider].label} 思考…` })
    try {
      const result = await callModel({
        provider,
        request,
        config,
        signal: controller.signal,
        onDelta: (delta) => {
          partial += delta
          send({ type: 'delta', text: delta })
        },
        onReset: () => {
          partial = ''
          send({ type: 'reset' })
        },
        onStatus: (status) => send({ type: 'status', text: status }),
      })
      const message: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content: result.text,
        createdAt: Date.now(),
        meta: { ...baseMeta(), model: result.model, ...(sources.length ? { sources } : {}) },
      }
      await appendReply(conversationId, message, skill)
      send({ type: 'done', message })
    } catch (error) {
      const stopped = controller.signal.aborted || isAbortError(error)
      if (stopped && partial.trim()) {
        const message: ChatMessage = {
          id: newId(),
          role: 'assistant',
          content: partial,
          createdAt: Date.now(),
          meta: { ...baseMeta(), interrupted: true },
        }
        await appendReply(conversationId, message, skill).catch(() => false)
        send({ type: 'done', message })
      } else {
        const reason = stopped ? '已停止回答。' : errorMessage(error)
        const saved: ChatMessage = {
          id: newId(),
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
          meta: { ...baseMeta(), error: reason, interrupted: stopped || undefined },
        }
        const ok = await appendReply(conversationId, saved, skill).catch(() => false)
        send({ type: 'error', message: reason, saved: ok ? saved : undefined })
      }
    } finally {
      clearInterval(ping)
      finishChat(body.runId)
      if (!closed) {
        closed = true
        try {
          sink.close()
        } catch {
          // already closed by the client
        }
      }
    }
  })()

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
})
