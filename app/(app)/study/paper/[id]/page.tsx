import type { Metadata } from 'next'
import { PaperView } from '@/components/library/paper-view'

export const metadata: Metadata = { title: '论文' }

export default async function PaperPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ page?: string | string[] }>
}) {
  const [{ id }, { page }] = await Promise.all([params, searchParams])
  const parsed = typeof page === 'string' ? Number.parseInt(page, 10) : Number.NaN
  return <PaperView key={id} id={id} page={Number.isInteger(parsed) && parsed > 0 ? parsed : null} />
}
