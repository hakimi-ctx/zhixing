import type { Metadata } from 'next'
import { FileView } from '@/components/study/file-view'

export const metadata: Metadata = { title: '文件库' }

export default async function FilePage({ searchParams }: { searchParams: Promise<{ path?: string | string[] }> }) {
  const { path } = await searchParams
  const target = typeof path === 'string' && path ? path : null
  return <FileView key={target ?? 'none'} path={target} />
}
