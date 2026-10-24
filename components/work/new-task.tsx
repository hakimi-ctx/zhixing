'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Banner, Button, Label, Link as PrimerLink } from '@primer/react'
import { RocketIcon } from '@primer/octicons-react'
import { mutate } from 'swr'
import { useNotice } from '@/components/ui/notices'
import { ProviderMark } from '@/components/ui/provider-mark'
import { api, errorText } from '@/lib/client/api'
import { providerReady } from '@/lib/client/config'
import { KEYS, useConfig, useSystem } from '@/lib/client/hooks'
import { PROVIDER_META } from '@/lib/shared/providers'
import { PROVIDER_IDS, type ProviderId } from '@/lib/shared/types'
import styles from './work.module.css'

const EXAMPLES = [
  '帮我准备一个“大学生时间管理”主题的 10 分钟课堂展示：大纲、每页要点和讲稿。',
  '为一个校园二手交易小程序设计数据库表、接口列表和两周的开发计划。',
  '对比 Zotero、EndNote 和 Mendeley，给研究生写一份文献管理工具选型建议。',
]

export function NewTask() {
  const router = useRouter()
  const notify = useNotice()
  const { data: config } = useConfig()
  const { data: system } = useSystem()
  const [task, setTask] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const enabled = PROVIDER_IDS.filter((id) => config?.providers[id].enabled ?? true)
  const supervisor: ProviderId | undefined = config
    ? enabled.includes(config.work.supervisor)
      ? config.work.supervisor
      : enabled[0]
    : 'chatgpt'
  const rules = config?.work

  const submit = async () => {
    const text = task.trim()
    if (text.length < 4) {
      notify({ variant: 'warning', text: '请把任务描述得具体一点（至少 4 个字）。' })
      return
    }
    if (submitting) return
    if (config && !PROVIDER_IDS.some((id) => providerReady(config, id))) {
      notify({ variant: 'danger', text: '还没有可用的模型。请先到设置里接入中转站并填好模型名。' })
      return
    }
    setSubmitting(true)
    try {
      const { id } = await api<{ id: string }>('/api/work/sessions', { method: 'POST', body: { task: text } })
      void mutate(KEYS.workSessions)
      router.push(`/work/${id}`)
    } catch (err) {
      notify({ variant: 'danger', text: errorText(err) })
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <h2 className={styles.heroTitle}>把任务交给 AI 团队</h2>
        <p className={styles.muted}>
          三个模型按上下级分工：主管拆解任务、分派给成员，成员各做一块，主管验收后汇总成可以直接执行的方案。返工轮数和调用次数都有上限，不会互相空转。
        </p>
      </div>

      {system?.preview ? (
        <Banner
          variant="info"
          title="你正在 v0 预览中"
          description="预览里没有你电脑上的会员命令行工具，三家模型会自动改走“内置通道”，可以先体验完整流程。"
        />
      ) : null}

      <ol className={styles.flow} aria-label="工作流程">
        <li className={styles.flowItem}>
          <span className={styles.flowTitle}>主管拆解</span>
          <span className={styles.small}>分析目标，拆成最多 {rules?.maxSubtasks ?? 4} 个互不重叠的子任务</span>
        </li>
        <li className={styles.flowItem}>
          <span className={styles.flowTitle}>成员执行</span>
          <span className={styles.small}>每个成员只做自己那一块，能看到别人的成果，不重复劳动</span>
        </li>
        <li className={styles.flowItem}>
          <span className={styles.flowTitle}>主管验收</span>
          <span className={styles.small}>只对真正有问题的部分要求返工，最多 {rules?.maxRevisions ?? 1} 轮</span>
        </li>
        <li className={styles.flowItem}>
          <span className={styles.flowTitle}>汇总方案</span>
          <span className={styles.small}>整合成可以直接执行的最终方案</span>
        </li>
        <li className={styles.flowItem}>
          <span className={styles.flowTitle}>交给执行器</span>
          <span className={styles.small}>用 WorkBuddy 或 DeepSeek Harness 在工作目录里落地，输出留在执行记录里</span>
        </li>
      </ol>

      <div className={styles.team} aria-label="团队成员">
        {PROVIDER_IDS.map((id) => {
          const provider = config?.providers[id]
          const on = provider?.enabled ?? true
          const role = !on ? '已停用' : id === supervisor ? '主管' : '成员'
          return (
            <div key={id} className={styles.member} data-off={!on}>
              <div className={styles.memberHead}>
                <span className={styles.memberName}>
                  <ProviderMark provider={id} size={18} />
                  {PROVIDER_META[id].label}
                </span>
                <Label variant={role === '主管' ? 'accent' : 'secondary'}>{role}</Label>
              </div>
              <span className={styles.small}>擅长{PROVIDER_META[id].strengths}</span>
              {provider && on && provider.model ? <span className={styles.small}>{provider.model}</span> : null}
            </div>
          )
        })}
      </div>

      <form
        className={styles.stack}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <textarea
          className={styles.taskInput}
          value={task}
          onChange={(event) => setTask(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit()
            }
          }}
          placeholder="描述你要完成的事情：目标、背景、限制条件、希望交付什么……"
          aria-label="任务描述"
          maxLength={20000}
        />
        <div className={styles.examples} aria-label="示例任务">
          {EXAMPLES.map((example) => (
            <button key={example} type="button" className={styles.example} onClick={() => setTask(example)}>
              {example}
            </button>
          ))}
        </div>
        <div className={styles.row}>
          <span className={styles.small}>
            {rules
              ? `最多 ${rules.maxSubtasks} 个子任务 · 最多返工 ${rules.maxRevisions} 轮 · 单次调用最长 ${Math.round(rules.callTimeoutSec / 60)} 分钟 · `
              : null}
            <PrimerLink as={Link} href="/settings">
              调整规则
            </PrimerLink>
          </span>
          <Button type="submit" variant="primary" leadingVisual={RocketIcon} loading={submitting} disabled={!task.trim() || !supervisor}>
            开始（Ctrl + Enter）
          </Button>
        </div>
      </form>
    </div>
  )
}
