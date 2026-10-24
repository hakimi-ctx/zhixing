import 'server-only'
import type { Conversation, ConversationSummary } from '@/lib/shared/types'
import { JsonCollection } from './collection'
import { paths } from './paths'

export const conversations = new JsonCollection<Conversation, ConversationSummary>(
  () => paths.conversations(),
  (conversation) => ({
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
  }),
)

export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (!line) return '新对话'
  return line.length > 30 ? `${line.slice(0, 30)}…` : line
}
