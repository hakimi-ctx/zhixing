'use client'

import Link from 'next/link'
import { Button, Flash, Label, Spinner } from '@primer/react'
import { FileIcon, NoteIcon, PaperclipIcon, SyncIcon } from '@primer/octicons-react'
import { CopyButton } from '@/components/ui/copy-button'
import { Markdown } from '@/components/ui/markdown'
import { ProviderMark } from '@/components/ui/provider-mark'
import type { ChatRun } from '@/lib/client/chat-store'
import { formatDuration } from '@/lib/client/format'
import { paperHref } from '@/lib/client/library'
import { TabLink } from '@/lib/client/tabs'
import { baseName } from '@/lib/client/vault'
import { displayName } from '@/lib/shared/mindmap'
import { PROVIDER_META } from '@/lib/shared/providers'
import { skillMeta } from '@/lib/shared/skills'
import type { ChatMessage, ChatSource, ProviderId } from '@/lib/shared/types'
import styles from './chat.module.css'

/** Turns the tutor's [1] markers into links to the cited paper, without touching markdown links already in the answer. */
function citeMarkdown(content: string, sources: ChatSource[] | undefined): string {
  if (!sources?.length) return content
  const byNumber = new Map(sources.map((source) => [source.n, source]))
  return content.replace(/\[(\d+)\](?!\()/g, (match, raw: string) => {
    const source = byNumber.get(Number(raw))
    if (!source) return match
    const title = source.title.replace(/["\\\]]/g, '')
    return `[[${raw}]](${paperHref(source.paperId, source.page)} "${title}")`
  })
}

export function UserMessage({ content, attachment }: { content: string; attachment?: string | null }) {
  return (
    <div className={styles.userRow}>
      <div className={styles.userBubble}>{content}</div>
      {attachment ? (
        <span className={`${styles.chip} ${styles.chipStatic}`}>
          <PaperclipIcon size={12} />
          <span className={styles.chipLabel}>{displayName(baseName(attachment))}</span>
        </span>
      ) : null}
    </div>
  )
}

function ReplyHeader({
  provider,
  model,
  skill,
  durationMs,
}: {
  provider?: ProviderId
  model?: string
  skill?: string | null
  durationMs?: number
}) {
  const method = skillMeta(skill)
  return (
    <div className={styles.assistantHeader}>
      {provider ? <ProviderMark provider={provider} /> : null}
      <span className={styles.assistantName}>{provider ? PROVIDER_META[provider].label : '导师'}</span>
      {model ? <span className={styles.model}>{model}</span> : null}
      {method ? <Label variant="accent">{method.title}</Label> : null}
      {durationMs ? <span>{formatDuration(durationMs)}</span> : null}
    </div>
  )
}

function Sources({ sources }: { sources?: ChatSource[] }) {
  if (!sources?.length) return null
  return (
    <div className={styles.sources}>
      <span className={styles.sourcesLabel}>来源</span>
      {sources.map((source) => (
        <TabLink key={`${source.n}-${source.paperId}`} href={paperHref(source.paperId, source.page)} className={styles.source}>
          <FileIcon size={12} />
          <span className={styles.sourceNumber}>[{source.n}]</span>
          <span className={styles.sourceTitle}>{source.title}</span>
          {source.page ? <span className={styles.sourcePage}>p.{source.page}</span> : null}
        </TabLink>
      ))}
    </div>
  )
}

interface AssistantMessageProps {
  message: ChatMessage
  isLast: boolean
  busy: boolean
  onRegenerate: () => void
  onSaveNote: (content: string) => void
}

export function AssistantMessage({ message, isLast, busy, onRegenerate, onSaveNote }: AssistantMessageProps) {
  const meta = message.meta ?? {}
  return (
    <article className={styles.assistant} aria-label="导师的回答">
      <ReplyHeader provider={meta.provider} model={meta.model} skill={meta.skill} durationMs={meta.durationMs} />
      {meta.error ? (
        <Flash variant={meta.interrupted ? 'warning' : 'danger'}>
          <div className={styles.errorText}>{meta.interrupted ? '已停止。' : meta.error}</div>
          {isLast ? (
            <div className={styles.flashActions}>
              <Button size="small" leadingVisual={SyncIcon} onClick={onRegenerate} disabled={busy}>
                重新回答
              </Button>
              {!meta.interrupted && /设置/.test(meta.error) ? (
                <Button size="small" variant="invisible" as={Link} href="/settings">
                  去设置
                </Button>
              ) : null}
            </div>
          ) : null}
        </Flash>
      ) : (
        <>
          <Markdown>{citeMarkdown(message.content, meta.sources)}</Markdown>
          <Sources sources={meta.sources} />
          {meta.interrupted ? <span className={styles.note}>回答被中途停止，只保存了已生成的部分。</span> : null}
          <div className={styles.messageActions}>
            <CopyButton text={message.content} />
            <Button size="small" variant="invisible" leadingVisual={NoteIcon} onClick={() => onSaveNote(message.content)}>
              存为笔记
            </Button>
            {isLast ? (
              <Button size="small" variant="invisible" leadingVisual={SyncIcon} onClick={onRegenerate} disabled={busy}>
                重新回答
              </Button>
            ) : null}
          </div>
        </>
      )}
    </article>
  )
}

interface PendingReplyProps {
  run: ChatRun
  onRegenerate: () => void
  onRestore: () => void
  onDismiss: () => void
}

export function PendingReply({ run, onRegenerate, onRestore, onDismiss }: PendingReplyProps) {
  if (run.error) {
    return (
      <article className={styles.assistant} aria-label="导师的回答">
        <ReplyHeader provider={run.provider} skill={run.skill} />
        <Flash variant="danger">
          <div className={styles.errorText}>{run.error}</div>
          <div className={styles.flashActions}>
            {run.started ? (
              <Button size="small" leadingVisual={SyncIcon} onClick={onRegenerate}>
                重新回答
              </Button>
            ) : (
              <Button size="small" onClick={onRestore}>
                放回输入框
              </Button>
            )}
            {/设置/.test(run.error) ? (
              <Button size="small" variant="invisible" as={Link} href="/settings">
                去设置
              </Button>
            ) : null}
            <Button size="small" variant="invisible" onClick={onDismiss}>
              关闭
            </Button>
          </div>
        </Flash>
      </article>
    )
  }
  return (
    <article className={styles.assistant} aria-label="导师正在回答" aria-busy="true">
      <ReplyHeader provider={run.provider} skill={run.skill} />
      {run.text ? <Markdown>{run.text}</Markdown> : null}
      <div className={styles.status} role="status">
        <Spinner size="small" srText={null} />
        <span>{run.stopping ? '正在停止…' : run.statusText || '正在生成…'}</span>
      </div>
    </article>
  )
}
