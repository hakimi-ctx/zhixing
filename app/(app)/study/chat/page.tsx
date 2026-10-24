import type { Metadata } from 'next'
import { ChatView } from '@/components/study/chat-view'

export const metadata: Metadata = { title: '问导师' }

export default async function NewChatPage({ searchParams }: { searchParams: Promise<{ attach?: string | string[] }> }) {
  const { attach } = await searchParams
  const attachment = typeof attach === 'string' && attach ? attach : null
  return <ChatView key={attachment ?? 'new'} initialAttachment={attachment} />
}
