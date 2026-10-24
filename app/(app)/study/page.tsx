import type { Metadata } from 'next'
import { LibraryView } from '@/components/library/library-view'

export const metadata: Metadata = { title: '文库' }

export default function StudyPage() {
  return <LibraryView />
}
