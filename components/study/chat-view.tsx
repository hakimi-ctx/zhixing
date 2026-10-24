'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ActionList, ActionMenu, Button, Flash, Spinner } from '@primer/react'
import { PageFrame } from '@/components/shell/page-frame'
import { useNotice } from '@/components/ui/notices'
import { ProviderMark } from '@/components/ui/provider-mark'
import { errorText } from '@/lib/client/api'
import { dismissRun, isRunActive, startChat, stopChatRun, useChatRuns } from '@/lib/client/chat-store'
import { patchConfig } from '@/lib/client/config'
import { useConfig, useConversation } from '@/lib/client/hooks'
import { saveTextAsNote } from '@/lib/client/notes'
import { TabLink } from '@/lib/client/tabs'
import { PROVIDER_META } from '@/lib/shared/providers'
import { SKILLS, type SkillMeta } from '@/lib/shared/skills'
import { PROVIDER_IDS, type AppConfig, type ProviderId } from '@/lib/shared/types'
import { AUTO_SKILL, ChatComposer } from './chat-composer'
import { AssistantMessage, PendingReply, UserMessage } from './chat-message'
import styles from './chat.module.css'

function ModelPicker({ value, config, onChange }: { value: ProviderId; config?: AppConfig; onChange: (id: ProviderId) => void }) {
  const Mark = () => <ProviderMark provider={value} />
  return (
    <ActionMenu>
      <ActionMenu.Button size="small" leadingVisual={Mark}>
        {PROVIDER_META[value].label}
      </ActionMenu.Button>
      <ActionMenu.Overlay width="medium" align="end">
        <ActionList selectionVariant="single" aria-label="选择导师使用的模型">
          {PROVIDER_IDS.map((id) => {
            const provider = config?.providers[id]
            const enabled = provider?.enabled ?? true
            return (
              <ActionList.Item key={id} selected={id === value} disabled={!enabled} onSelect={() => onChange(id)}>
                <ActionList.LeadingVisual>
                  <ProviderMark provider={id} />
                </ActionList.LeadingVisual>
                {PROVIDER_META[id].label}
                <ActionList.Description variant="block">
                  {enabled ? provider?.model || '未填写模型' : '已停用'}
                </ActionList.Description>
              </ActionList.Item>
            )
          })}
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}

function EmptyState({ onPick }: { onPick: (skill: SkillMeta) => void }) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyHeading}>
        <h2 className={styles.emptyTitle}>想请导师指导什么？</h2>
        <p className={styles.emptyText}>导师读过你文库里的全部论文，回答会标出出处。</p>
      </div>
      <div className={styles.skillGrid}>
        {SKILLS.map((skill) => (
          <button key={skill.name} type="button" className={styles.skillCard} onClick={() => onPick(skill)}>
            <span className={styles.skillTitle}>{skill.title}</span>
            <span className={styles.skillSummary}>{skill.summary}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

interface ChatViewProps {
  conversationId?: string
  initialAttachment?: string | null
}

export function ChatView({ conversationId, initialAttachment = null }: ChatViewProps) {
  const router = useRouter()
  const notify = useNotice()
  const { data: config } = useConfig()
  const { data: conversation, error } = useConversation(conversationId)
  const runs = useChatRuns()
  const [ownRunId, setOwnRunId] = useState<string | null>(null)
  const run = runs.find((item) => (conversationId ? item.conversationId === conversationId : item.runId === ownRunId))
  const busy = Boolean(run && isRunActive(run))
  const [providerChoice, setProviderChoice] = useState<ProviderId | null>(null)
  const provider = providerChoice ?? config?.study.provider ?? 'chatgpt'
  const [skill, setSkill] = useState(AUTO_SKILL)
  const [draft, setDraft] = useState('')
  const [attachment, setAttachment] = useState<string | null>(initialAttachment)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const messages = useMemo(() => conversation?.messages ?? [], [conversation])
  const stickyAttachment = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const attached = messages[index].role === 'user' ? messages[index].meta?.attachment : null
      if (attached) return attached
    }
    return null
  }, [messages])

  const showEmptyState = !conversationId && !run

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || showEmptyState || !stickToBottom.current) return
    scroller.scrollTop = scroller.scrollHeight
  }, [showEmptyState, messages.length, run?.text, run?.statusText, run?.error, run?.started])

  useEffect(() => {
    inputRef.current?.focus()
  }, [conversationId])

  const chooseProvider = (id: ProviderId) => {
    setProviderChoice(id)
    if (config && config.study.provider !== id) {
      void patchConfig({ study: { provider: id } }).catch((err) => notify({ variant: 'danger', text: errorText(err) }))
    }
  }

  const send = () => {
    const message = draft.trim()
    if (!message || busy) return
    if (config && !config.providers[provider].enabled) {
      notify({ variant: 'warning', text: `${PROVIDER_META[provider].label} 已停用，请换一个模型。` })
      return
    }
    stickToBottom.current = true
    const runId = startChat({
      conversationId,
      message,
      provider,
      skill,
      attachment,
      onCreated: (id) => {
        if (mounted.current) router.replace(`/study/chat/${id}`)
      },
    })
    if (!conversationId) setOwnRunId(runId)
    setDraft('')
    setAttachment(null)
  }

  const regenerate = () => {
    if (!conversationId || busy) return
    if (run) dismissRun(run.runId)
    stickToBottom.current = true
    startChat({ conversationId, regenerate: true, provider, skill })
  }

  const restore = () => {
    if (!run) return
    setDraft(run.userText)
    dismissRun(run.runId)
    inputRef.current?.focus()
  }

  const saveNote = async (content: string) => {
    try {
      const path = await saveTextAsNote(conversation?.title ?? '导师的回答', content)
      notify({ variant: 'success', text: `已存到文件库：${path}` })
    } catch (err) {
      notify({ variant: 'danger', text: errorText(err) })
    }
  }

  const pickSkill = (item: SkillMeta) => {
    setSkill(item.name)
    setDraft(item.starter)
    requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    })
  }

  let body: React.ReactNode
  if (error) {
    body = (
      <div className={styles.thread}>
        <Flash variant="danger">{errorText(error)}</Flash>
        <div>
          <Button as={TabLink} href="/study/chat">
            开始新对话
          </Button>
        </div>
      </div>
    )
  } else if (conversationId && !conversation) {
    body = (
      <div className={styles.center}>
        <Spinner srText="正在打开对话" />
      </div>
    )
  } else if (showEmptyState) {
    body = <EmptyState onPick={pickSkill} />
  } else {
    body = (
      <div className={styles.thread}>
        {messages.map((message, index) =>
          message.role === 'user' ? (
            <UserMessage key={message.id} content={message.content} attachment={message.meta?.attachment} />
          ) : (
            <AssistantMessage
              key={message.id}
              message={message}
              isLast={!run && index === messages.length - 1}
              busy={busy}
              onRegenerate={regenerate}
              onSaveNote={(content) => void saveNote(content)}
            />
          ),
        )}
        {run && !run.started && !run.regenerate && run.userText ? <UserMessage content={run.userText} /> : null}
        {run ? (
          <PendingReply run={run} onRegenerate={regenerate} onRestore={restore} onDismiss={() => dismissRun(run.runId)} />
        ) : null}
      </div>
    )
  }

  return (
    <PageFrame
      title={conversation?.title ?? (conversationId ? '对话' : '新对话')}
      body="fill"
      actions={<ModelPicker value={provider} config={config} onChange={chooseProvider} />}
    >
      <div className={styles.chat}>
        <div
          ref={scrollerRef}
          className={styles.scroller}
          onScroll={(event) => {
            const target = event.currentTarget
            stickToBottom.current = target.scrollHeight - target.scrollTop - target.clientHeight < 80
          }}
        >
          {body}
        </div>
        <ChatComposer
          value={draft}
          onChange={setDraft}
          onSubmit={send}
          onStop={() => run && void stopChatRun(run.runId)}
          busy={busy}
          stopping={Boolean(run?.stopping)}
          disabled={Boolean(error)}
          skill={skill}
          onSkillChange={setSkill}
          attachment={attachment}
          onAttachmentChange={setAttachment}
          stickyAttachment={attachment ? null : stickyAttachment}
          inputRef={inputRef}
        />
      </div>
    </PageFrame>
  )
}
