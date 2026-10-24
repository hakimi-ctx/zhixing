import { Label } from '@primer/react'
import type { ExecutionRecord, StepStatus } from '@/lib/shared/types'

const STEP: Record<StepStatus, { text: string; variant: 'secondary' | 'accent' | 'success' | 'danger' }> = {
  pending: { text: '等待中', variant: 'secondary' },
  running: { text: '进行中', variant: 'accent' },
  done: { text: '已完成', variant: 'success' },
  failed: { text: '失败', variant: 'danger' },
  skipped: { text: '已跳过', variant: 'secondary' },
}

/** A step marked failed with the stop reason is shown as "stopped", not as an error. */
export function StepLabel({ status, error }: { status: StepStatus; error?: string }) {
  if (status === 'failed' && error === '已停止') return <Label variant="attention">已停止</Label>
  const { text, variant } = STEP[status]
  return <Label variant={variant}>{text}</Label>
}

const EXECUTION: Record<ExecutionRecord['status'], { text: string; variant: 'accent' | 'success' | 'danger' | 'attention' }> = {
  running: { text: '执行中', variant: 'accent' },
  done: { text: '已完成', variant: 'success' },
  failed: { text: '失败', variant: 'danger' },
  stopped: { text: '已停止', variant: 'attention' },
}

export function ExecutionLabel({ status }: { status: ExecutionRecord['status'] }) {
  const { text, variant } = EXECUTION[status]
  return <Label variant={variant}>{text}</Label>
}
