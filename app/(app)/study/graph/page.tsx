import type { Metadata } from 'next'
import { GraphView } from '@/components/library/graph-view'

export const metadata: Metadata = { title: '关系图谱' }

export default function GraphPage() {
  return <GraphView />
}
