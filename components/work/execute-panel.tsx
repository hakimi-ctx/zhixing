'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button, Dialog, Flash, Link as PrimerLink, SegmentedControl, Textarea } from '@primer/react'
import { CopyIcon, FileDirectoryIcon, PlayIcon, StopIcon } from '@primer/octicons-react'
import { Card } from '@/components/ui/card'
import { CopyButton } from '@/components/ui/copy-button'
import { useNotice } from '@/components/ui/notices'
import { api, errorText } from '@/lib/client/api'
import { clockTime, formatDuration } from '@/lib/client/format'
import { useConfig, useSystem } from '@/lib/client/hooks'
import type { ExecutionPreview, ExecutionRecord, ExecutorKind, WorkSession } from '@/lib/shared/types'
import { ExecutionLabel } from './status-label'
import styles from './work.module.css'

function ExecutionItem({
  sessionId,
  execution,
  canOpenFolder,
  onChanged,
}: {
  sessionId: string
  execution: ExecutionRecord
  canOpenFolder: boolean
  onChanged: () => void
}) {
  const notify = useNotice()
  const outputRef = useRef<HTMLPreElement>(null)
  const [stopping, setStopping] = useState(false)

  useEffect(() => {
    const output = outputRef.current
    if (output && execution.status === 'running') output.scrollTop = output.scrollHeight
  }, [execution.output, execution.status])

  const stop = async () => {
    setStopping(true)
    try {
      await api(`/api/work/sessions/${sessionId}/executions/${execution.id}/stop`, { method: 'POST' })
      onChanged()
    } catch (err) {
      notify({ variant: 'danger', text: errorText(err) })
    } finally {
      setStopping(false)
    }
  }

  const reveal = async () => {
    try {
      await api('/api/system/reveal', { method: 'POST', body: { scope: 'workspace', sessionId, executionId: execution.id } })
    } catch (err) {
      notify({ variant: 'danger', text: errorText(err) })
    }
  }

  return (
    <div className={styles.subtask}>
      <div className={styles.subtaskHead}>
        <span className={styles.subtaskTitle}>{execution.executorName}</span>
        <div className={styles.meta}>
          <span>{clockTime(execution.startedAt)}</span>
          <span>{formatDuration((execution.endedAt ?? Date.now()) - execution.startedAt)}</span>
          <ExecutionLabel status={execution.status} />
        </div>
      </div>
      {execution.error ? <Flash variant={execution.status === 'stopped' ? 'warning' : 'danger'}>{execution.error}</Flash> : null}
      <pre ref={outputRef} className={styles.terminal} aria-label={`${execution.executorName} 的输出`} tabIndex={0}>
        {execution.output || (execution.status === 'running' ? '等待输出…' : '（没有输出）')}
      </pre>
      <div className={styles.actionsRow}>
        {execution.status === 'running' ? (
          <Button size="small" variant="danger" leadingVisual={StopIcon} onClick={() => void stop()} loading={stopping}>
            停止
          </Button>
        ) : null}
        {canOpenFolder ? (
          <Button size="small" leadingVisual={FileDirectoryIcon} onClick={() => void reveal()}>
            打开工作目录
          </Button>
        ) : null}
        {execution.output ? <CopyButton text={execution.output} label="复制输出" /> : null}
      </div>
    </div>
  )
}

export function ExecutePanel({ session, onChanged }: { session: WorkSession; onChanged: () => void }) {
  const notify = useNotice()
  const { data: config } = useConfig()
  const { data: system } = useSystem()
  const executors = (config?.executors ?? []).filter((item) => item.enabled)
  const [executorId, setExecutorId] = useState<ExecutorKind | null>(null)
  const chosen = executors.find((item) => item.id === executorId) ?? executors[0]
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState<ExecutionPreview | null>(null)
  const [busy, setBusy] = useState<'preview' | 'run' | 'handoff' | null>(null)
  const running = session.executions.some((item) => item.status === 'running')

  const openPreview = async () => {
    if (!chosen) return
    setBusy('preview')
    try {
      setPreview(
        await api<ExecutionPreview>(`/api/work/sessions/${session.id}/execute`, {
          method: 'POST',
          body: { executorId: chosen.id, preview: true },
        }),
      )
    } catch (err) {
      notify({ variant: 'danger', text: errorText(err) })
    } finally {
      setBusy(null)
    }
  }

  const run = async () => {
    if (!chosen) return
    setBusy('run')
    try {
      await api(`/api/work/sessions/${session.id}/execute`, { method: 'POST', body: { executorId: chosen.id, note } })
      setPreview(null)
      setNote('')
      onChanged()
    } catch (err) {
      notify({ variant: 'danger', text: errorText(err) })
    } finally {
      setBusy(null)
    }
  }

  /** For running the executor by hand: write HANDOFF.md, copy the instruction, open the folder. */
  const handoff = async () => {
    setBusy('handoff')
    try {
      const result = await api<{ instruction: string }>(`/api/work/sessions/${session.id}/execute`, {
        method: 'POST',
        body: { handoffOnly: true, note },
      })
      await navigator.clipboard.writeText(result.instruction).catch(() => undefined)
      if (system?.canOpenFolder) {
        await api('/api/system/reveal', { method: 'POST', body: { scope: 'session', sessionId: session.id } }).catch(() => undefined)
      }
      notify({ variant: 'success', text: '指令已复制，粘贴到执行器里即可' })
    } catch (err) {
      notify({ variant: 'danger', text: errorText(err) })
    } finally {
      setBusy(null)
    }
  }

  const selectedIndex = Math.max(0, executors.findIndex((item) => item.id === chosen?.id))

  return (
    <Card title="交给执行器" description="选择 WorkBuddy 或 DeepSeek Harness。确认命令后再运行，输出记在下面。">
      <div className={styles.stack}>
        {!config ? null : executors.length === 0 ? (
          <Flash variant="warning">
            执行器都已关闭。
            <PrimerLink as={Link} href="/settings">
              去设置
            </PrimerLink>
          </Flash>
        ) : (
          <>
            <SegmentedControl
              aria-label="执行器"
              fullWidth
              onChange={(index) => setExecutorId(executors[index]?.id ?? null)}
            >
              {executors.map((item, index) => (
                <SegmentedControl.Button key={item.id} selected={index === selectedIndex}>
                  {item.name}
                </SegmentedControl.Button>
              ))}
            </SegmentedControl>
            <Textarea
              block
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="补充要求（可选）"
              aria-label="补充要求"
              maxLength={10000}
            />
            <div className={styles.actionsRow}>
              <Button
                variant="primary"
                leadingVisual={PlayIcon}
                onClick={() => void openPreview()}
                loading={busy === 'preview'}
                disabled={running || !chosen || Boolean(system?.preview)}
              >
                {running ? '正在执行…' : `交给 ${chosen?.name ?? '执行器'}`}
              </Button>
              <Button leadingVisual={CopyIcon} onClick={() => void handoff()} loading={busy === 'handoff'}>
                复制指令
              </Button>
            </div>
          </>
        )}

        {session.executions.length ? (
          <div className={styles.stack}>
            {[...session.executions].reverse().map((execution) => (
              <ExecutionItem
                key={execution.id}
                sessionId={session.id}
                execution={execution}
                canOpenFolder={Boolean(system?.canOpenFolder)}
                onChanged={onChanged}
              />
            ))}
          </div>
        ) : null}
      </div>

      {preview ? (
        <Dialog
          title={`交给 ${preview.executorName}？`}
          onClose={() => setPreview(null)}
          footerButtons={[
            { buttonType: 'default', content: '取消', onClick: () => setPreview(null) },
            {
              buttonType: 'primary',
              content: '执行',
              onClick: () => void run(),
              loading: busy === 'run',
              disabled: !preview.resolvedPath,
            },
          ]}
        >
          <div className={styles.dialogBody}>
            <div>
              <div className={styles.fieldLabel}>命令</div>
              <pre className={styles.code}>{preview.commandLine}</pre>
            </div>
            <div>
              <div className={styles.fieldLabel}>工作目录</div>
              <pre className={styles.code}>{preview.cwd}</pre>
            </div>
            {preview.resolvedPath ? null : (
              <Flash variant="danger">
                没有找到 {preview.executorName}。
                <PrimerLink as={Link} href="/settings">
                  去设置安装
                </PrimerLink>
              </Flash>
            )}
          </div>
        </Dialog>
      ) : null}
    </Card>
  )
}
