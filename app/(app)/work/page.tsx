import type { Metadata } from 'next'
import { PageFrame } from '@/components/shell/page-frame'
import { NewTask } from '@/components/work/new-task'

export const metadata: Metadata = { title: '新任务' }

export default function WorkPage() {
  return (
    <PageFrame title="新任务">
      <NewTask />
    </PageFrame>
  )
}
