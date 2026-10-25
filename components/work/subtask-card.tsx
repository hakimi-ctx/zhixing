'use client'

import { useState } from 'react'
import { Button, Flash, Label, Spinner } from '@primer/react'
import { ChevronDownIcon, ChevronRightIcon } from '@primer/octicons-react'
import { Markdown } from '@/components/ui/markdown'
import { ProviderMark } from '@/components/ui/provider-mark'
import { formatDuration } from '@/lib/client/format'
import { useConfig } from '@/lib/client/hooks'
import { providerLabel } from '@/lib/shared/providers'
import type { WorkAttempt, WorkSubtask } from '@/lib/shared/types'
import { StepLabel } from './status-label'
import styles from './work.module.css'

export function LongText({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 1800
  return (
    <div>
      <div className={long && !open ? styles.clamped : undefined}>
        <Markdown>{text}</Markdown>
      </div>
      {long ? (
        <Button size="small" variant="invisible" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? '收起' : '展开全部'}
        </Button>
      ) : null}
    </div>
  )
}

function elapsed(attempt: WorkAttempt): string | null {
  if (!attempt.startedAt) return null
  return formatDuration((attempt.endedAt ?? Date.now()) - attempt.startedAt)
}

function AttemptBody({ attempt }: { attempt: WorkAttempt }) {
  const { data: config } = useConfig()
  const who = providerLabel(attempt.by, config?.providers)
  if (attempt.status === 'running' && !attempt.output) {
    return (
      <div className={styles.meta} role="status">
        <Spinner size="small" srText={null} />
        {who} 正在处理…（会员通道要等全部写完才会显示内容）
      </div>
    )
  }
  if (attempt.output) return <LongText text={attempt.output} />
  if (attempt.status === 'failed') {
    return <Flash variant={attempt.error === '已停止' ? 'warning' : 'danger'}>{attempt.error ?? '失败'}</Flash>
  }
  return null
}

export function SubtaskCard({ subtask, index }: { subtask: WorkSubtask; index: number }) {
  const [showSpec, setShowSpec] = useState(false)
  const { data: config } = useConfig()
  const { attempts } = subtask
  const latest = attempts[attempts.length - 1]
  let shown: WorkAttempt | undefined = latest
  if (latest && latest.status !== 'running') {
    for (let i = attempts.length - 1; i >= 0; i -= 1) {
      if (attempts[i].status === 'done') {
        shown = attempts[i]
        break
      }
    }
  }
  const earlier = attempts.filter((attempt) => attempt !== shown)
  const by = shown?.by ?? subtask.assignee
  const byName = providerLabel(by, config?.providers)
  const time = shown ? elapsed(shown) : null
  const titleId = `subtask-${subtask.id}`

  return (
    <section className={styles.subtask} aria-labelledby={titleId}>
      <div className={styles.subtaskHead}>
        <h3 id={titleId} className={styles.subtaskTitle}>
          <span className={styles.index}>{index + 1}</span>
          {subtask.title}
        </h3>
        <div className={styles.meta}>
          <span className={styles.inline}>
            <ProviderMark provider={by} label={byName} />
            {byName}
          </span>
          {shown?.model ? <span>{shown.model}</span> : null}
          {time ? <span>{time}</span> : null}
          <StepLabel status={latest?.status ?? 'pending'} error={latest?.error} />
        </div>
      </div>

      {shown?.note ? (
        <div>
          <Label variant="attention">{shown.note}</Label>
        </div>
      ) : null}
      {shown?.feedback ? (
        <div className={styles.feedback}>
          <strong>主管的返工意见：</strong>
          {shown.feedback}
        </div>
      ) : null}

      <div>
        <Button
          size="small"
          variant="invisible"
          leadingVisual={showSpec ? ChevronDownIcon : ChevronRightIcon}
          onClick={() => setShowSpec((value) => !value)}
          aria-expanded={showSpec}
        >
          分工要求
        </Button>
        {showSpec ? (
          <div className={styles.requirements}>
            <div>
              <strong>要做什么：</strong>
              {subtask.instructions}
            </div>
            <div>
              <strong>交付物：</strong>
              {subtask.deliverable}
            </div>
          </div>
        ) : null}
      </div>

      {shown ? <AttemptBody attempt={shown} /> : <p className={styles.small}>等待主管安排执行。</p>}
      {latest && latest !== shown && latest.status === 'failed' ? (
        <Flash variant="warning">最近一次尝试没有成功：{latest.error ?? '未知原因'}。上面显示的是之前完成的版本。</Flash>
      ) : null}

      {earlier.length ? (
        <details className={styles.history}>
          <summary>历史版本（{earlier.length}）</summary>
          <div className={styles.historyList}>
            {earlier.map((attempt, position) => (
              <div key={`${attempt.startedAt ?? position}-${attempt.by}`} className={styles.stack}>
                <div className={styles.meta}>
                  <span className={styles.inline}>
                    <ProviderMark provider={attempt.by} label={providerLabel(attempt.by, config?.providers)} />
                    {providerLabel(attempt.by, config?.providers)}
                  </span>
                  <StepLabel status={attempt.status} error={attempt.error} />
                  {attempt.note ? <span>{attempt.note}</span> : null}
                </div>
                {attempt.feedback ? <div className={styles.feedback}>返工意见：{attempt.feedback}</div> : null}
                <AttemptBody attempt={attempt} />
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  )
}
