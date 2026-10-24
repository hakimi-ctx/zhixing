'use client'

import { useSyncExternalStore } from 'react'
import { mutate } from 'swr'
import type { ChatMessage, ChatStreamEvent, ProviderId } from '@/lib/shared/types'
import { KEYS, type ConversationDetail } from './hooks'

/**
 * Tutor replies stream into this store instead of component state, so a reply
 * keeps going (and stays visible) while the user opens notes or other chats.
 */
export interface ChatRun {
  runId: string
  conversationId: string | null
  provider: ProviderId
  userText: string
  regenerate: boolean
  started: boolean
  statusText: string
  text: string
  skill: string | null
  error: string | null
  stopping: boolean
  startedAt: number
}

export interface StartChatInput {
  conversationId?: string
  message?: string
  regenerate?: boolean
  provider: ProviderId
  skill: string
  attachment?: string | null
  onCreated?: (conversationId: string) => void
}

const EMPTY: readonly ChatRun[] = []
let runs: readonly ChatRun[] = EMPTY
const listeners = new Set<() => void>()

function setRuns(next: readonly ChatRun[]) {
  runs = next
  for (const listener of listeners) listener()
}

function patchRun(runId: string, patch: Partial<ChatRun> | ((run: ChatRun) => Partial<ChatRun>)) {
  setRuns(runs.map((run) => (run.runId === runId ? { ...run, ...(typeof patch === 'function' ? patch(run) : patch) } : run)))
}

function removeRun(runId: string) {
  setRuns(runs.filter((run) => run.runId !== runId))
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useChatRuns(): readonly ChatRun[] {
  return useSyncExternalStore(
    subscribe,
    () => runs,
    () => EMPTY,
  )
}

export function isRunActive(run: ChatRun): boolean {
  return run.error === null
}

function withoutTrailingReplies(messages: ChatMessage[]): ChatMessage[] {
  let end = messages.length
  while (end > 0 && messages[end - 1].role === 'assistant') end -= 1
  return messages.slice(0, end)
}

function appendMessages(conversationId: string, additions: ChatMessage[]) {
  void mutate<ConversationDetail>(
    KEYS.conversation(conversationId),
    (current) => {
      if (!current) return current
      const known = new Set(current.messages.map((message) => message.id))
      const fresh = additions.filter((message) => !known.has(message.id))
      const updatedAt = Math.max(current.updatedAt, ...additions.map((message) => message.createdAt))
      return { ...current, updatedAt, messages: [...current.messages, ...fresh] }
    },
    { revalidate: false },
  )
}

async function readError(response: Response): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: string } | null
  return data?.error ?? `请求失败（${response.status}）`
}

async function execute(runId: string, input: StartChatInput) {
  let conversationId = input.conversationId ?? null
  let finished = false

  const fail = (message: string) => {
    finished = true
    patchRun(runId, { error: message, statusText: '' })
    if (conversationId) void mutate(KEYS.conversation(conversationId))
    void mutate(KEYS.conversations)
  }

  const handle = (event: ChatStreamEvent) => {
    switch (event.type) {
      case 'start': {
        conversationId = event.conversationId
        const key = KEYS.conversation(event.conversationId)
        if (input.conversationId) {
          void mutate<ConversationDetail>(
            key,
            (current) => {
              if (!current) return current
              const base = input.regenerate ? withoutTrailingReplies(current.messages) : current.messages
              const messages = base.some((message) => message.id === event.userMessage.id) ? base : [...base, event.userMessage]
              return { ...current, title: event.title, running: true, messages }
            },
            { revalidate: false },
          )
        } else {
          const now = event.userMessage.createdAt
          const fresh: ConversationDetail = {
            id: event.conversationId,
            title: event.title,
            createdAt: now,
            updatedAt: now,
            lastSkill: event.skill,
            messages: [event.userMessage],
            running: true,
          }
          void mutate(key, fresh, { revalidate: false })
        }
        patchRun(runId, { conversationId: event.conversationId, started: true, skill: event.skill })
        void mutate(KEYS.conversations)
        if (!input.conversationId) input.onCreated?.(event.conversationId)
        break
      }
      case 'status':
        patchRun(runId, { statusText: event.text })
        break
      case 'delta':
        patchRun(runId, (run) => ({ text: run.text + event.text, statusText: '' }))
        break
      case 'reset':
        patchRun(runId, { text: '' })
        break
      case 'done': {
        finished = true
        if (conversationId) appendMessages(conversationId, [event.message])
        removeRun(runId)
        if (conversationId) void mutate(KEYS.conversation(conversationId))
        void mutate(KEYS.conversations)
        break
      }
      case 'error': {
        if (event.saved && conversationId) {
          finished = true
          appendMessages(conversationId, [event.saved])
          removeRun(runId)
          void mutate(KEYS.conversation(conversationId))
          void mutate(KEYS.conversations)
        } else {
          fail(event.message)
        }
        break
      }
      case 'ping':
        break
    }
  }

  let response: Response
  try {
    response = await fetch('/api/study/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId,
        conversationId: input.conversationId,
        message: input.message,
        regenerate: input.regenerate ?? false,
        provider: input.provider,
        skill: input.skill,
        attachment: input.attachment ?? null,
      }),
      cache: 'no-store',
    })
  } catch {
    fail('连不上知行的本地服务。请确认启动窗口还开着。')
    return
  }
  if (!response.ok || !response.body) {
    fail(await readError(response))
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        if (!line) continue
        let event: ChatStreamEvent
        try {
          event = JSON.parse(line) as ChatStreamEvent
        } catch {
          continue
        }
        handle(event)
      }
    }
  } catch {
    // The connection dropped; handled below.
  }
  if (!finished) fail('和本地服务的连接中断了，这条回答可能没有完整保存。')
}

export function startChat(input: StartChatInput): string {
  const runId = crypto.randomUUID()
  const run: ChatRun = {
    runId,
    conversationId: input.conversationId ?? null,
    provider: input.provider,
    userText: input.message ?? '',
    regenerate: input.regenerate ?? false,
    started: false,
    statusText: '正在连接…',
    text: '',
    skill: null,
    error: null,
    stopping: false,
    startedAt: Date.now(),
  }
  setRuns([...runs, run])
  void execute(runId, input)
  return runId
}

export async function stopChatRun(runId: string): Promise<void> {
  patchRun(runId, { stopping: true, statusText: '正在停止…' })
  try {
    await fetch('/api/study/chat/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    })
  } catch {
    patchRun(runId, { stopping: false })
  }
}

export function dismissRun(runId: string): void {
  removeRun(runId)
}
