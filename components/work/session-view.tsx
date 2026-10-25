'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Banner, Button, Flash, Spinner } from '@primer/react'
import { CheckCircleFillIcon, CircleIcon, DashIcon, NoteIcon, PlayIcon, StopIcon, XCircleFillIcon } from '@primer/octicons-react'
import { mutate as globalMutate } from 'swr'
import { PageFrame } from '@/components/shell/page-frame'
import { Card } from '@/components/ui/card'
import { CopyButton } from '@/components/ui/copy-button'
import { Markdown } from '@/components/ui/markdown'
import { useNotice } from '@/components/ui/notices'
import { ProviderMark } from '@/components/ui/provider-mark'
import { api, errorText } from '@/lib/client/api'
import { clockTime } from '@/lib/client/format'
import { KEYS, useConfig, useWorkSession } from '@/lib/client/hooks'
import { saveTextAsNote } from '@/lib/client/notes'
import { providerLabel } from '@/lib/shared/providers'
import type { WorkPhase, WorkSession } from '@/lib/shared/types'
import { ExecutePanel } from './execute-panel'
import { StepLabel } from './status-label'
import { SubtaskCard } from './subtask-card'
import styles from './work.module.css'

type StepState = 'done' | 'current' | 'failed' | 'pending' | 'skipped'

const PHASE_STEP: Record<WorkPhase, number> = { planning: 0, executing: 1, reviewing: 2, revising: 2, finalizing: 3, done: 4 }

function stepsOf(session: WorkSession): { label: string; hint: string; state: StepState }[] {
  const current = PHASE_STEP[session.phase]
  const count = session.subtasks.length
  const delivered = session.subtasks.filter((subtask) => subtask.attempts.some((attempt) => attempt.status === 'done')).length
  const noTeamWork = session.plan.status === 'done' && count === 0
  const haltHint = session.status === 'stopped' ? '已停止' : '出错了'
  const steps = [
    { label: '主管拆解', hint: session.plan.status === 'done' ? (count ? `拆成 ${count} 个子任务` : '无需分工') : '', skip: false },
    { label: '成员执行', hint: count ? `${delivered}/${count} 已交付` : '', skip: noTeamWork },
    {
      label: '主管验收',
      hint:
        session.review.status === 'skipped'
          ? '已跳过'
          : session.review.rounds
            ? `返工 ${session.review.rounds} 轮`
            : session.review.decision === 'approve'
              ? '一次通过'
              : '',
      skip: noTeamWork || session.review.status === 'skipped',
    },
    { label: '汇总方案', hint: session.final.status === 'done' ? '已完成' : '', skip: false },
  ]
  return steps.map((step, index) => {
    let state: StepState = 'pending'
    if (step.skip) state = 'skipped'
    else if (index < current) state = 'done'
    else if (index === current) state = session.status === 'running' ? 'current' : session.status === 'done' ? 'done' : 'failed'
    const hint = state === 'failed' ? haltHint : step.hint
    return { label: step.label, hint, state }
  })
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <CheckCircleFillIcon />
  if (state === 'current') return <Spinner size="small" srText={null} />
  if (state === 'failed') return <XCircleFillIcon />
  if (state === 'skipped') return <DashIcon />
  return <CircleIcon />
}

function Steps({ session }: { session: WorkSession }) {
  return (
    <ol className={styles.steps} aria-label="任务进度">
      {stepsOf(session).map((step) => (
        <li
          key={step.label}
          className={styles.step}
          data-state={step.state === 'skipped' ? 'pending' : step.state}
          aria-current={step.state === 'current' ? 'step' : undefined}
        >
          <StepIcon state={step.state} />
          <span className={styles.stepLabel}>
            <span>{step.label}</span>
            {step.hint ? <span className={styles.stepHint}>{step.hint}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  )
}

function Working({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.meta} role="status">
      <Spinner size="small" srText={null} />
      {children}
    </div>
  )
}

function useSlotName() {
  const { data: config } = useConfig()
  return (id: string) => providerLabel(id, config?.providers)
}

function PlanBody({ session }: { session: WorkSession }) {
  const name = useSlotName()
  const { plan } = session
  const supervisor = name(session.supervisor)
  if (plan.status === 'running') return <Working>{supervisor} 正在分析任务、安排分工…</Working>
  if (plan.status === 'done') {
    return (
      <div className={styles.stack}>
        <Markdown>{plan.analysis}</Markdown>
        <div className={styles.meta}>
          {plan.model ? <span>{plan.model}</span> : null}
          <span>
            成员：{session.workers.length ? session.workers.map((id) => name(id)).join('、') : '无，由主管独自完成'}
          </span>
        </div>
      </div>
    )
  }
  if (plan.status === 'failed') {
    return (
      <div className={styles.stack}>
        <Flash variant={plan.error === '已停止' ? 'warning' : 'danger'}>{plan.error ?? '拆解失败'}</Flash>
        {plan.output ? (
          <details className={styles.history}>
            <summary>主管的原始回复</summary>
            <pre className={styles.terminal}>{plan.output}</pre>
          </details>
        ) : null}
      </div>
    )
  }
  return <p className={styles.small}>等待开始。</p>
}

function ReviewBody({ session }: { session: WorkSession }) {
  const name = useSlotName()
  const { review } = session
  const titleOf = (id: string) => session.subtasks.find((subtask) => subtask.id === id)?.title ?? id
  const requested = review.requested?.length ? (
    <ul className={styles.stack}>
      {review.requested.map((item) => (
        <li key={item.id} className={styles.feedback}>
          <strong>{titleOf(item.id)}：</strong>
          {item.feedback}
        </li>
      ))}
    </ul>
  ) : null
  if (review.status === 'skipped') return <p className={styles.small}>返工轮数设为 0，跳过了验收，由主管直接汇总。</p>
  if (review.status === 'running') {
    return review.decision === 'revise' ? (
      <div className={styles.stack}>
        <Working>主管要求返工（第 {review.rounds ?? 1}/{session.rules.maxRevisions} 轮），成员正在修改…</Working>
        {requested}
      </div>
    ) : (
      <Working>{name(session.supervisor)} 正在逐项检查成员的交付…</Working>
    )
  }
  if (review.status === 'done') {
    if (review.decision === 'approve') {
      return <p className={styles.muted}>主管认可了全部交付{review.rounds ? `（经过 ${review.rounds} 轮返工）` : ''}。</p>
    }
    return (
      <div className={styles.stack}>
        <p className={styles.muted}>返工 {review.rounds ?? 0} 轮后结束验收，剩下的小问题由主管在汇总时修正，不再来回返工。</p>
        {requested}
      </div>
    )
  }
  if (review.status === 'failed') return <Flash variant={review.error === '已停止' ? 'warning' : 'danger'}>{review.error ?? '验收失败'}</Flash>
  return <p className={styles.small}>成员全部交付后，主管会逐项验收。</p>
}

function FinalBody({ session }: { session: WorkSession }) {
  const name = useSlotName()
  const { final } = session
  if (final.status === 'running') {
    return (
      <div className={styles.stack}>
        {final.output ? <Markdown>{final.output}</Markdown> : null}
        <Working>{name(session.supervisor)} 正在汇总最终方案…</Working>
      </div>
    )
  }
  if (final.status === 'done') return <Markdown>{final.output}</Markdown>
  if (final.status === 'failed') return <Flash variant={final.error === '已停止' ? 'warning' : 'danger'}>{final.error ?? '汇总失败'}</Flash>
  return <p className={styles.small}>成员交付并通过验收后，主管会在这里给出最终方案。</p>
}

function LogCard({ session }: { session: WorkSession }) {
  const [all, setAll] = useState(false)
  if (!session.log.length) return null
  const entries = all ? session.log : session.log.slice(-12)
  return (
    <Card
      title="运行日志"
      description="每一步的分工、通道切换和异常都记在这里"
      actions={
        session.log.length > 12 ? (
          <Button size="small" variant="invisible" onClick={() => setAll((value) => !value)}>
            {all ? '只看最近' : `显示全部 ${session.log.length} 条`}
          </Button>
        ) : null
      }
    >
      <ol className={styles.log}>
        {entries.map((entry, index) => (
          <li
            key={`${entry.at}-${index}`}
            className={`${styles.logItem} ${entry.level === 'error' ? styles.logError : entry.level === 'warn' ? styles.logWarn : ''}`}
          >
            <span className={styles.logTime}>{clockTime(entry.at)}</span>
            <span>{entry.text}</span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

export function SessionView({ id }: { id: string }) {
  const notify = useNotice()
  const { data: session, error, mutate } = useWorkSession(id)
  const [acting, setActing] = useState<'stop' | 'resume' | null>(null)
  const [savingNote, setSavingNote] = useState(false)
  const name = useSlotName()

  const refresh = () => {
    void mutate()
    void globalMutate(KEYS.workSessions)
  }

  const act = async (kind: 'stop' | 'resume') => {
    setActing(kind)
    try {
      await api(`/api/work/sessions/${id}/${kind}`, { method: 'POST' })
      refresh()
    } catch (err) {
      notify({ variant: 'danger', text: errorText(err) })
    } finally {
      setActing(null)
    }
  }

  if (error) {
    return (
      <PageFrame title="任务">
        <div className={styles.page}>
          <Flash variant="danger">{errorText(error)}</Flash>
          <div>
            <Button as={Link} href="/work">
              新建任务
            </Button>
          </div>
        </div>
      </PageFrame>
    )
  }
  if (!session) {
    return (
      <PageFrame title="任务">
        <div className={styles.center}>
          <Spinner srText="正在读取任务" />
        </div>
      </PageFrame>
    )
  }

  const supervisor = name(session.supervisor)
  const running = session.status === 'running'
  const resumable = session.status === 'failed' || session.status === 'stopped'
  const reviewStatus = session.review.status

  const saveFinal = async () => {
    setSavingNote(true)
    try {
      const body = `> 由知行 Work 模式生成，主管：${supervisor}\n\n## 任务\n\n${session.task}\n\n## 最终方案\n\n${session.final.output}`
      const path = await saveTextAsNote(session.title, body)
      notify({ variant: 'success', text: `已存到文件库：${path}` })
    } catch (err) {
      notify({ variant: 'danger', text: errorText(err) })
    } finally {
      setSavingNote(false)
    }
  }

  const resumeAction = (
    <Banner.PrimaryAction onClick={() => void act('resume')} disabled={acting !== null}>
      继续运行
    </Banner.PrimaryAction>
  )

  return (
    <PageFrame
      title={session.title}
      meta={
        <>
          <span className={styles.inline}>
            <ProviderMark provider={session.supervisor} label={supervisor} />
            主管 {supervisor}
          </span>
          <span>已调用 {session.calls} 次</span>
        </>
      }
      actions={
        running ? (
          <Button size="small" variant="danger" leadingVisual={StopIcon} loading={acting === 'stop'} onClick={() => void act('stop')}>
            停止
          </Button>
        ) : resumable ? (
          <Button size="small" variant="primary" leadingVisual={PlayIcon} loading={acting === 'resume'} onClick={() => void act('resume')}>
            继续运行
          </Button>
        ) : null
      }
    >
      <div className={styles.page}>
        <Steps session={session} />

        {session.status === 'failed' ? (
          <Banner variant="critical" title="任务没有完成" description={session.error ?? '出了点问题。'} primaryAction={resumeAction} />
        ) : null}
        {session.status === 'stopped' ? (
          <Banner variant="warning" title="任务已停止" description="已经完成的部分都保存着，可以从停下的地方继续运行。" primaryAction={resumeAction} />
        ) : null}

        <Card title="任务" description={`创建于 ${new Date(session.createdAt).toLocaleString('zh-CN')}`}>
          <div className={styles.taskText}>{session.task}</div>
        </Card>

        <Card
          title="主管拆解"
          leading={<ProviderMark provider={session.supervisor} label={supervisor} size={20} />}
          description={`${supervisor} 负责拆解、验收和汇总`}
          actions={<StepLabel status={session.plan.status} error={session.plan.error} />}
        >
          <PlanBody session={session} />
        </Card>

        {session.subtasks.length ? (
          <>
            <div className={styles.sectionHeading}>
              <h2 className={styles.sectionTitle}>成员分工（{session.subtasks.length}）</h2>
            </div>
            <div className={styles.stack}>
              {session.subtasks.map((subtask, index) => (
                <SubtaskCard key={subtask.id} subtask={subtask} index={index} />
              ))}
            </div>
            <Card title="主管验收" actions={<StepLabel status={reviewStatus} error={session.review.error} />}>
              <ReviewBody session={session} />
            </Card>
          </>
        ) : null}

        <Card
          title="最终方案"
          actions={
            session.final.status === 'done' ? (
              <>
                <CopyButton text={session.final.output} />
                <Button size="small" leadingVisual={NoteIcon} onClick={() => void saveFinal()} loading={savingNote}>
                  存到文件库
                </Button>
              </>
            ) : (
              <StepLabel status={session.final.status} error={session.final.error} />
            )
          }
        >
          <FinalBody session={session} />
        </Card>

        {session.final.status === 'done' ? <ExecutePanel session={session} onChanged={refresh} /> : null}

        <LogCard session={session} />
      </div>
    </PageFrame>
  )
}
