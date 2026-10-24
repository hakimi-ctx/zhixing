import type { Metadata } from 'next'
import { SessionView } from '@/components/work/session-view'

export const metadata: Metadata = { title: '任务' }

export default async function WorkSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <SessionView key={id} id={id} />
}
